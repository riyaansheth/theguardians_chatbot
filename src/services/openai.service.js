// OpenAI is used for exactly two things: (a) extract structured slots from a
// user message via function-calling, (b) phrase a reply grounded ONLY in the
// data we pass it. It never decides flow and never sources facts.
import OpenAI from "openai";
import { env } from "../config/env.js";

// Treat obvious placeholders as "no key" so the app degrades gracefully offline.
const keyLooksReal =
  typeof env.openaiApiKey === "string" &&
  env.openaiApiKey.startsWith("sk-") &&
  !env.openaiApiKey.includes("placeholder");

const client = keyLooksReal ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

export function llmAvailable() {
  return client !== null;
}

// Function schema the model fills (CLAUDE.md spec, verbatim shape).
export const EXTRACT_TOOL = {
  type: "function",
  function: {
    name: "extract_preferences",
    description:
      "Extract any real-estate preferences stated by the user. Omit fields not mentioned.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        purpose: { type: "string", enum: ["self-use", "investment", "both"] },
        property_type: { type: "string", enum: ["residential", "commercial"] },
        family_members: { type: "integer" },
        earning_members: { type: "integer" },
        has_parents: { type: "boolean" },
        has_children: { type: "boolean" },
        preferred_location: { type: "string" },
        workplace_location: { type: "string" },
        school_or_college_location: { type: "string" },
        budget_min: { type: "integer" },
        budget_max: { type: "integer" },
        bhk: { type: "string" },
        bathrooms: { type: "integer" },
        possession_preference: { type: "string", enum: ["ready", "under-construction"] },
        parking_required: { type: "boolean" },
        amenities: { type: "array", items: { type: "string" } },
        vastu_required: { type: "boolean" },
        pet_friendly_required: { type: "boolean" },
        site_visit_required: { type: "boolean" },
        preferred_callback_time: { type: "string" },
      },
    },
  },
};

const EXTRACT_SYSTEM =
  "You extract structured real-estate preferences from the conversation. " +
  "Call extract_preferences with ONLY the fields the user EXPLICITLY stated. " +
  "Do not guess or infer unstated fields. " +
  "CRITICAL: never infer a budget from numbers that are not money — the number of " +
  "brothers, family members, earning members or bedrooms is NOT a budget. Only set " +
  "budget_min/budget_max when the user states an amount in money terms (e.g. lakh, " +
  "crore, ₹). Only set earning_members if the user explicitly states it. " +
  "Counts of people/bedrooms map to family_members or bhk, never to budget. " +
  "Prices are in Indian Rupees (1 crore = 10,000,000; 1 lakh = 100,000).";

// Shared persona — THE GUARDIAN behaves like a seasoned human advisor, per
// personality.md. Both the "ask" and "recommend" prompts build on this.
const PERSONA = `You are THE GUARDIAN, the senior property advisor for The Guardians — an experienced human real estate consultant in Mumbai who has helped hundreds of families buy homes and investments. You are NOT a chatbot and never say or imply that you are.

Who you are: friendly but not casual; confident but not arrogant; helpful but never pushy; honest but never discouraging; consultative, not transactional. You speak naturally, like a real broker.

How you think: your job is to understand what the customer truly needs — even what they can't put into words. Think before answering; someone may ask for one thing but actually need another. Gently understand the reason behind each preference. Never make a customer feel their preference is wrong — acknowledge it, gently educate, offer a better-fitting path, and let them decide. When it helps, weigh real-life factors: family size and future growth, schools, hospitals, commute, lifestyle, daily convenience, and the investment angle (appreciation, resale, rental demand, long-term value).

How you speak: always explain your reasoning — people trust explanations more than recommendations. Never pressure; prefer "this could be worth considering because…" over "you should buy this", and "one of the strongest matches based on what you've shared" over "the best property". Keep replies concise — about 40–120 words (a little more only when comparing several options). Never sound robotic: never use phrases like "I am an AI", "according to the database", "I cannot", "no results found", or "I don't have that". Instead say things like "from the properties I currently have…", "one option that stands out is…", or "this might be worth a look because…". If a detail isn't available, never guess — say "I'd rather not guess — I can have our team confirm that for you." If USER.name is provided, use their first name warmly, but not in every line.`;

// The recommendation prompt — persona + the anti-hallucination grounding contract.
export const GROUNDED_PROMPT = `${PERSONA}

You are now recommending real options. You will be given USER, an OPENING line, MATCHED_PROPERTIES and DOCUMENT_CHUNKS. Use ONLY facts present in that data for any property detail.

- Begin your reply with the exact OPENING line provided — never write your own opener and never claim you couldn't find a match unless OPENING says so.
- Recommend only properties in MATCHED_PROPERTIES. Never invent a project, price, possession, RERA, carpet area, availability or amenity. Quote provided values exactly and consistently.
- Use a fallback line ONLY when that specific field is null or empty:
    price -> "Price details are not available in my current data."
    availability -> "Availability will need to be confirmed by The Guardians team."
    RERA -> "RERA details are not available in my current data."
    possession -> "Possession details are not available in my current data."
- Use the most specific locality (each property's "area"). For each option give: project, area, configuration, price (or fallback), possession (or fallback), and a short, specific reason it fits THIS customer — tie it to their family size, commute, lifestyle, space or value, not generic praise.
- A property with match_type "close" is a near-fit: present it honestly (e.g. "a close option, a few minutes away…") and mention what's relaxed (its "note").
- When options are close rather than exact: acknowledge the customer's preference, briefly explain why an exact match is hard, offer the close options with reasons, and let them decide — never stop at "no".
- If several strong options exist, compare trade-offs objectively (location vs space, ready vs under-construction) rather than crowning a single winner.
- No legal, financial or guaranteed-return advice. Close by warmly offering a call with an advisor or a site visit.`;

// The conversation prompt — persona + the deterministic slot-filling guard rails.
const ASK_SYSTEM = `${PERSONA}

Right now you are getting to know the customer. You will be given the conversation, USER, and the next detail(s) to learn.

1. First, respond like a real advisor to what they just said: acknowledge their situation, answer a brief question if they asked one, or gently educate where it helps — e.g. if five people want a 2 BHK, note a 2 BHK may feel restrictive over time and you'd be glad to show 3 BHKs too; if a wish looks hard (a sea-view 3 BHK in South Mumbai at a low budget), don't reject it — say it's challenging and offer to explore nearby areas or a small budget adjustment. If they go off-topic or vent, respond warmly in one line and steer back.
2. Then naturally ask for the next detail(s). You do NOT control the flow — always move toward the asked detail(s), at most two, and never dump a list.

Use these facts for general questions (don't go beyond them):
- A trusted Mumbai real estate advisory, 9+ years, offices in Mumbai, Pune and Dubai; 39,500+ units sold for India's leading developers.
- Coverage: South Mumbai (Colaba, Churchgate, Malabar Hill, Worli, Lower Parel, Byculla) through the western suburbs (Bandra, Khar, Santacruz, Vile Parle) up to Andheri and beyond, plus Thane and Navi Mumbai.
- Services: residential, commercial, retail, marketing consulting, land development, and dedicated NRI advisory.
- For buyers, our guidance and site visits are complimentary — we're compensated by developers, not by you.
- How it works: understand your needs, shortlist matching projects, arrange site visits, assist through booking and paperwork.

Never state specific PROPERTY facts (exact prices, project names, availability, RERA) here — those come only at recommendation time.`;

export async function extractPreferences(openAIMessages) {
  if (!client) return null;
  const res = await client.chat.completions.create({
    model: env.openaiChatModel,
    temperature: 0,
    messages: [{ role: "system", content: EXTRACT_SYSTEM }, ...openAIMessages],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "function", function: { name: "extract_preferences" } },
  });
  const call = res.choices[0]?.message?.tool_calls?.[0];
  if (!call) return {};
  try {
    return JSON.parse(call.function.arguments);
  } catch {
    return {};
  }
}

// Phrase the next-question turn. The model sees the real conversation (history),
// so it can respond to what the user actually said before asking the next thing.
export async function phraseAsk({ history, userName, nextQuestion, secondQuestion, advisorNote }) {
  if (!client) return null;
  const want = secondQuestion ? `"${nextQuestion}" and "${secondQuestion}"` : `"${nextQuestion}"`;
  const guide =
    `USER = ${JSON.stringify({ name: userName || null })}\n` +
    (advisorNote ? `ADVISOR NOTE (weave in gently and naturally): ${advisorNote}\n` : "") +
    `Now write your reply: first respond naturally to the user's most recent message above, ` +
    `then ask for ${want}.`;
  const res = await client.chat.completions.create({
    model: env.openaiChatModel,
    temperature: 0.6,
    messages: [{ role: "system", content: ASK_SYSTEM }, ...history, { role: "system", content: guide }],
  });
  return res.choices[0]?.message?.content?.trim() ?? null;
}

// Phrase the recommendation turn, grounded ONLY in the provided data block.
export async function phraseRecommend({ history, userName, dataBlock }) {
  if (!client) return null;
  const res = await client.chat.completions.create({
    model: env.openaiChatModel,
    temperature: 0.2,
    messages: [
      { role: "system", content: GROUNDED_PROMPT },
      ...history,
      { role: "user", content: `USER = ${JSON.stringify({ name: userName || null })}\n${dataBlock}` },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? null;
}
