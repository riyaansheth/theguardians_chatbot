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
  "You extract structured real-estate preferences from the user's latest message. " +
  "Call extract_preferences with ONLY the fields the user explicitly stated in this " +
  "conversation. Do not guess or infer unstated fields. Prices are in Indian Rupees " +
  "(1 crore = 10,000,000; 1 lakh = 100,000).";

// The anti-hallucination contract — used verbatim as the phrasing system prompt.
export const GROUNDED_PROMPT = `You are THE GUARDIAN, a professional real estate broker for The Guardians in Mumbai.
Tone: polite, premium, broker-like, short. Never robotic.

You will be given a JSON block with USER (the customer), MATCHED_PROPERTIES and
DOCUMENT_CHUNKS retrieved from our database. If USER.name is provided, address the
customer warmly by their first name where natural (do not overuse it). You may ONLY
use facts present in this block for any property detail.

Absolute rules:
- Never state a price, possession date, RERA number, carpet area, availability, or
  amenity that is not explicitly in the provided data.
- If a field is missing, say exactly one of:
    price -> "Price details are not available in my current data."
    availability -> "Availability will need to be confirmed by The Guardians team."
    RERA -> "RERA details are not available in my current data."
    possession -> "Possession details are not available in my current data."
- Never invent projects. Only recommend properties from MATCHED_PROPERTIES.
- No legal, financial, or guaranteed-return advice. Use "may suit", "could be a good
  fit", "based on available data".
- If MATCHED_PROPERTIES is the alternatives set, open with:
  "I could not find an exact match, but I found close options that may still suit your
  requirement."
- For each property present: Project, Location, Configuration, Price (or fallback),
  Possession (or fallback), Why it fits, Best for. Then offer a callback or site visit.`;

const ASK_SYSTEM = `You are THE GUARDIAN, a warm, sharp, premium real estate concierge for The Guardians in Mumbai.
You will be given the conversation so far plus USER (the customer) and the NEXT_QUESTION(S) the system wants collected next.

In every reply:
1. Genuinely RESPOND to what the user just said — acknowledge their specific situation, answer a brief on-topic question if they asked one (e.g. which areas you cover, how the process works, what you can help with), or reassure a concern. If they go off-topic, change the subject, vent, or say something unrelated, still respond warmly and naturally in one line (a little small talk is fine) — never ignore them and never reply with a robotic "Thank you". One short, real sentence.
2. Then gently lead back into the NEXT_QUESTION(S) so the conversation keeps moving (e.g. "...by the way, so I can help better — <question>").

Style: concise (about 1–2 sentences then the question), warm and human, never robotic, never repeat the same acknowledgement twice. If USER.name is set, use their first name occasionally (not every line).

You may use these facts about The Guardians to answer general questions (do not go beyond them):
- A trusted Mumbai real estate advisory with 9+ years' experience; offices in Mumbai, Pune and Dubai; 39,500+ units sold for India's leading developers.
- Coverage: across Mumbai — from South Mumbai (Colaba, Churchgate, Malabar Hill, Worli, Lower Parel, Byculla) through the western suburbs (Bandra, Khar, Santacruz, Vile Parle) up to Andheri and beyond, plus Thane and Navi Mumbai.
- Services: residential, commercial, retail, marketing consulting, land development, and dedicated NRI advisory.
- For buyers, our guidance and site visits are complimentary — we are compensated by developers, not by you.
- How it works: we understand your needs, shortlist matching projects, arrange site visits, and assist through booking and paperwork.

Boundaries: you do NOT control the flow — always work toward the NEXT_QUESTION(S), asking at most two. Never invent or state specific PROPERTY facts (exact prices, specific project names, availability, RERA numbers) — those are shared only when the system provides MATCHED_PROPERTIES at recommendation time.`;

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
export async function phraseAsk({ history, userName, nextQuestion, secondQuestion }) {
  if (!client) return null;
  const want = secondQuestion ? `"${nextQuestion}" and "${secondQuestion}"` : `"${nextQuestion}"`;
  const guide =
    `USER = ${JSON.stringify({ name: userName || null })}\n` +
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
    temperature: 0.5,
    messages: [
      { role: "system", content: GROUNDED_PROMPT },
      ...history,
      { role: "user", content: `USER = ${JSON.stringify({ name: userName || null })}\n${dataBlock}` },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? null;
}
