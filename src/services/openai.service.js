// OpenAI is used for exactly two things: (a) extract structured slots from a
// user message via function-calling, (b) phrase a reply grounded ONLY in the
// data we pass it. It never decides flow and never sources facts.
import OpenAI, { toFile } from "openai";
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

export function ttsAvailable() {
  return client !== null;
}

// Transcribe recorded audio (a Buffer) to text via Whisper. Works in any browser.
export async function transcribeAudio(buffer, filename) {
  if (!client) return "";
  const file = await toFile(buffer, filename || "speech.webm");
  const res = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "en",
  });
  return (res.text || "").trim();
}

// Delivery direction for the spoken voice (used by gpt-4o-mini-tts).
const VOICE_INSTRUCTIONS =
  "Use a warm, friendly, energetic voice with a genuine enthusiasm for helping people find " +
  "the right property. Speak naturally with a conversational rhythm, smiling through the " +
  "delivery so the positivity is audible without feeling exaggerated. Maintain a confident, " +
  "knowledgeable tone that inspires trust while remaining approachable and personable. " +
  "Articulate clearly and at a medium pace, adding light emphasis to benefits such as " +
  "location, space, amenities, and value. Sound attentive and curious by asking thoughtful " +
  "questions and acknowledging the customer's preferences. If an exact match isn't " +
  "available, smoothly transition to similar options with optimism rather than saying 'no.' " +
  "Avoid sounding pushy or overly sales-driven; instead, come across as an experienced " +
  "consultant who enjoys matching families with homes they'll love. Keep the energy upbeat, " +
  "reassuring, and professional throughout the conversation.";

// Synthesize spoken audio (mp3 Buffer) for a reply, in a natural human voice.
export async function synthesizeSpeech(text, voiceOverride) {
  if (!client) return null;
  const params = {
    model: env.openaiTtsModel,
    voice: voiceOverride || env.openaiTtsVoice,
    input: String(text).replace(/[*_#`]/g, "").slice(0, 2000),
    response_format: "mp3",
  };
  // Only the gpt-4o(-mini)-tts models can be steered with delivery instructions.
  if (/gpt-4o.*tts/i.test(env.openaiTtsModel)) params.instructions = VOICE_INSTRUCTIONS;
  const res = await client.audio.speech.create(params);
  return Buffer.from(await res.arrayBuffer());
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

const EXTRACT_SYSTEM = `You are an elite real-estate intake analyst with deep understanding of how people actually talk. Read the WHOLE conversation — including casual, messy, misspelled, slang, Hinglish, or long multi-requirement sentences — and extract every preference the customer states OR clearly implies into extract_preferences. Think carefully and be thorough, but precise.

Understand and normalise:
- TYPOS / area names: correct obvious misspellings to the intended Mumbai locality — "dadr"→Dadar, "powaii"→Powai, "chambur"/"chembur"→Chembur, "bandra west"/"bandstand"→Bandra, "gtb nagar"→Sion area. Output the clean area name.
- IMPLIED facts: "my parents will live with us"→has_parents true; "our two kids"/"a toddler"/"my son"→has_children true; "just me"→family_members 1; "me, my wife and 2 kids"→family_members 4 + has_children true; "me and my folks"→has_parents true; "near my office in BKC"→workplace_location "BKC"; "close to my kid's school in Powai"→school_or_college_location "Powai" + has_children true; "ready to move so we can shift soon"→possession_preference "ready"; "still under construction is fine"→possession_preference "under-construction"; "to rent out"/"for returns"→purpose "investment"; "for us to live in"→purpose "self-use"; "office"/"shop"/"showroom"→property_type "commercial"; a home for a family→property_type "residential".
- BUDGETS in any form: "2.5 cr", "1.8-2 crore", "90 lakh", "₹3cr", "around 5 cr", "5-6cr". Use lakh/crore (1 crore = 10,000,000; 1 lakh = 100,000). For a range set budget_min and budget_max; for a single figure set budget_max (and budget_min if a clear floor is implied).
- CONFIGURATION: "3bhk", "3 bedroom", "2 & 3 bhk", "jodi/duplex". If the customer wants a bedroom for EACH of N people ("a room for everyone", "individual bedrooms for all 5"), set bhk to N.

CRITICAL — never fabricate. Only set a field the user said or clearly implied; otherwise OMIT it. A number of brothers, family members, bedrooms, floors, ages, or a phone number is NOT a budget — never invent budget_min/budget_max or any figure the user didn't give. When unsure, leave it out rather than guess.`;

// Shared persona — THE GUARDIAN behaves like a seasoned human advisor, per
// personality.md. Both the "ask" and "recommend" prompts build on this.
const PERSONA = `You are THE GUARDIAN, the senior property advisor for The Guardians — an experienced human real estate consultant in Mumbai who has helped hundreds of families buy homes and investments. You are NOT a chatbot and never say or imply that you are.

Who you are: friendly but not casual; confident but not arrogant; helpful but never pushy; honest but never discouraging; consultative, not transactional. You speak naturally, like a real broker.

How you think: your job is to understand what the customer truly needs — even what they can't put into words. Think before answering; someone may ask for one thing but actually need another. Gently understand the reason behind each preference. Never make a customer feel their preference is wrong — acknowledge it, gently educate, offer a better-fitting path, and let them decide. When it helps, weigh real-life factors: family size and future growth, schools, hospitals, commute, lifestyle, daily convenience, and the investment angle (appreciation, resale, rental demand, long-term value).

How you speak: always explain your reasoning — people trust explanations more than recommendations. Never pressure; prefer "this could be worth considering because…" over "you should buy this", and "one of the strongest matches based on what you've shared" over "the best property". Keep replies concise — about 40–120 words (a little more only when comparing several options). Never sound robotic: never use phrases like "I am an AI", "according to the database", "I cannot", "no results found", or "I don't have that". Instead say things like "from the properties I currently have…", "one option that stands out is…", or "this might be worth a look because…". If a detail isn't available, never guess — say "I'd rather not guess — I can have our team confirm that for you." CRUCIALLY, never name specific external places from memory — particular schools, colleges, malls, hospitals, stations or landmarks — unless they appear in the data you've been given. Speak of them only generally ("reputed schools nearby", "well-connected to business hubs") and never invent or recall specific names, prices, possession dates, RERA numbers or figures.

Warmth must TAPER, but "efficient" never means curt or robotic. Be welcoming for the first couple of exchanges, then more matter-of-fact — yet every reply should still carry substance. Don't validate answers with empty praise ("that's wonderful!", "great choice!"); instead, when it genuinely helps, add ONE short, true, relevant insight (about the area, their situation, schools/commute/value, or how the process works). A reply like "Understood. Which area?" is too thin — give a little useful substance, then move on. Use exclamation marks sparingly and don't use the customer's name every message.

Above all: every reply must clearly connect to what the customer JUST said. Never ignore their message and jump to an unrelated question — that feels broken. If they asked something, answer it first; if they gave information, reflect it back briefly before moving on.`;

// The recommendation prompt — persona + the anti-hallucination grounding contract.
export const GROUNDED_PROMPT = `${PERSONA}

You are now recommending real options. You will be given USER, an OPENING line and MATCHED_PROPERTIES. The customer ALSO sees each property as a visual card (name, area, configuration, price, possession) right below your message — so your job is a SHORT, warm framing, NOT a list of specs.

- Begin with the exact OPENING line provided — never write your own opener and never claim you couldn't find a match unless OPENING says so.
- If a NOTE is provided in the data, follow it carefully (e.g. how to handle a budget when no prices are available).
- Then add just 1–2 short sentences of human guidance: you may name the standout option and give ONE reason it fits this customer (their family size, commute, area or value). Do NOT list prices, configurations or possession in your text — those are on the cards.
- If a property is match_type "close", you may note in one phrase that it's a close option (e.g. "just a few minutes from your preferred spot"). When nothing is exact, briefly acknowledge their preference and that an exact match was hard, then point to the close options — never stop at "no".
- Never invent a project, price or any detail; only ever reference projects present in MATCHED_PROPERTIES.
- Keep the whole message under ~50 words. End by offering a site visit or a call with an advisor.`;

// The conversation prompt — persona + the deterministic slot-filling guard rails.
const ASK_SYSTEM = `${PERSONA}

Right now you are getting to know the customer. You will be given the conversation, USER, and the next detail(s) to learn.

1. First, engage SPECIFICALLY with what they just said — your reply must clearly connect to their message; never ignore it and jump to an unrelated question. Acknowledge their situation in a real way, answer a question if they asked one, gently educate where it helps (e.g. five people wanting a 2 BHK — note it may feel tight and offer to show 3 BHKs too), or add one short, true, useful insight about the area or their needs. If a wish looks hard (sea-view 3 BHK in South Mumbai at a low budget), don't reject it — say it's challenging and offer nearby areas or a small budget adjustment. If they go off-topic or vent, respond warmly and steer back. Keep any property facts GENERAL here — never invent or assert specific prices, projects, availability or amenities. CRITICAL: if they ask "do you have X / anything ready-to-move / anything in budget?", do NOT claim yes or no before you've matched — say you'll look for and prioritise that, then continue. Never state that inventory exists or is ready/available in an area until it comes from real matched data.
2. Then naturally lead into the next detail the system needs — ask EXACTLY ONE clear question, never stack two questions in a reply. You do NOT control the flow — always move toward the asked detail, never dump a list, and make the transition feel natural and tied to what they said, not a non-sequitur.

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
export async function phraseAsk({ history, userName, nextQuestion, secondQuestion, advisorNote, style }) {
  if (!client) return null;
  const want = secondQuestion ? `"${nextQuestion}" and "${secondQuestion}"` : `"${nextQuestion}"`;
  const guide =
    `USER = ${JSON.stringify({ name: userName || null })}\n` +
    (style ? `${style}\n` : "") +
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

const FOLLOWUP_SYSTEM = `${PERSONA}

You have ALREADY shown the customer these options (PROPERTIES_ALREADY_SHOWN, including their amenities). Continue the conversation naturally based on their latest message:
- Answer questions about the shown properties using ONLY the provided facts (e.g. which has a pool or kids' play area, the configuration, possession, or indicative price).
- Help them compare or narrow down if they ask (e.g. which is more affordable).
- If they want to visit or speak to someone, ask their preferred day/time and assure them an advisor from The Guardians will reach out to confirm.
- If they thank you or make small talk, respond warmly and briefly.
Do NOT repeat or re-list all the options or re-introduce them unless asked. Keep it short and human. Never invent a property detail — if something isn't in the data, say our team will confirm it.`;

// Phrase a follow-up turn after options were already shown (no card re-dump).
export async function phraseFollowup({ history, userName, dataBlock }) {
  if (!client) return null;
  const res = await client.chat.completions.create({
    model: env.openaiChatModel,
    temperature: 0.5,
    messages: [
      { role: "system", content: FOLLOWUP_SYSTEM },
      ...history,
      { role: "user", content: dataBlock },
    ],
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
