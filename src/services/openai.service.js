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

You will be given a JSON block of MATCHED_PROPERTIES and DOCUMENT_CHUNKS retrieved
from our database. You may ONLY use facts present in that block.

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

const ASK_SYSTEM =
  "You are THE GUARDIAN, a professional, premium real estate broker for The Guardians " +
  "in Mumbai. Tone: polite, warm, concise, never robotic. You will be given the NEXT " +
  "QUESTION(S) to ask. Briefly acknowledge what the user just said, then ask the given " +
  "question(s) naturally. Ask at most two short questions. Do not ask anything else and " +
  "do not invent property details.";

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

// Phrase a reply. `system` is GROUNDED_PROMPT (recommend) or ASK_SYSTEM (ask).
export async function phraseReply(system, dataBlock) {
  if (!client) return null;
  const res = await client.chat.completions.create({
    model: env.openaiChatModel,
    temperature: 0.4,
    messages: [
      { role: "system", content: system },
      { role: "user", content: dataBlock },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? null;
}

export { ASK_SYSTEM };
