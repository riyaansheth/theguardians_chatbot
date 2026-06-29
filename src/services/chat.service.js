// The chat loop. The LLM is NOT in charge: flow + matching are deterministic;
// the LLM only extracts slots and phrases grounded replies.
import { query } from "../config/db.js";
import {
  llmAvailable,
  extractPreferences,
  phraseAsk,
  phraseRecommend,
} from "./openai.service.js";
import { findRecommendations } from "./matching.service.js";
import { retrieveChunksForProperties } from "./embedding.service.js";
import { firstMissingSlot, nextQuestion } from "../utils/questions.js";
import { scoreLead, leadTier, deriveTargetBHK } from "../utils/scoring.js";
import { bhkNumber } from "../utils/normalize.js";
import { isValidIndianPhone, normalizePhone, isValidEmail } from "../utils/validate.js";
import { extractHeuristic } from "./extract.heuristic.js";

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---- persistence -----------------------------------------------------------
async function ensureSession(sessionId, pageUrl) {
  await query(
    `INSERT INTO chat_sessions (id, page_url) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET updated_at = now(),
       page_url = COALESCE(chat_sessions.page_url, EXCLUDED.page_url)`,
    [sessionId, pageUrl ?? null]
  );
}

async function saveMessage(sessionId, role, content) {
  await query(
    `INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)`,
    [sessionId, role, content]
  );
}

async function getHistory(sessionId, limit = 12) {
  const res = await query(
    `SELECT role, content FROM messages WHERE session_id = $1
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [sessionId, limit]
  );
  return res.rows.reverse();
}

async function getLead(sessionId) {
  const res = await query(`SELECT * FROM leads WHERE session_id = $1`, [sessionId]);
  return res.rows[0] ?? null;
}

async function upsertLead(sessionId, prefs, leadScore) {
  await query(
    `INSERT INTO leads (session_id, name, phone, email, prefs, lead_score, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
     ON CONFLICT (session_id) DO UPDATE SET
       name       = COALESCE(EXCLUDED.name, leads.name),
       phone      = COALESCE(EXCLUDED.phone, leads.phone),
       email      = COALESCE(EXCLUDED.email, leads.email),
       prefs      = EXCLUDED.prefs,
       lead_score = EXCLUDED.lead_score,
       updated_at = now()`,
    [
      sessionId,
      prefs.name ?? null,
      prefs.phone ?? null,
      prefs.email ?? null,
      JSON.stringify(prefs),
      leadScore,
    ]
  );
}

async function loadProperties() {
  const res = await query(`SELECT * FROM properties`);
  return res.rows;
}

// ---- helpers ---------------------------------------------------------------
function mergePrefs(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

function toOpenAIHistory(history) {
  return history.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
}

function formatRecommendation(match) {
  const p = match.property;
  return {
    id: p.id,
    project_name: p.project_name,
    developer: p.developer_name || null,
    area: p.micro_location || p.location,
    location: p.location,
    configuration: p.bhk || p.configuration || null,
    price_text: p.price_text || null,
    possession_status: p.possession_status || null,
    is_exact: match.isExact !== false,
    score: match.score,
    relaxation: match.relaxation ?? null,
    why_it_fits: match.explanation.whyItFits,
    best_for: match.explanation.bestFor,
  };
}

// Build the user-turn data block for the grounded phrasing call.
// The customer's first name (for personalization), or null.
function firstName(prefs) {
  return prefs && prefs.name ? String(prefs.name).trim().split(/\s+/)[0] : null;
}

function buildRecommendBlock(matches, isAlternatives, documentChunks, name) {
  const matched = matches.map((m) => {
    const p = m.property;
    return {
      project: p.project_name,
      area: p.micro_location || p.location,
      configuration: p.bhk || p.configuration || null,
      price: p.price_text || null,
      possession: p.possession_status || null,
      rera: p.rera_number || null,
      match_type: m.isExact === false ? "close" : "exact",
      note: m.isExact === false && m.relaxation ? `close option — ${m.relaxation}` : null,
      why_it_fits: m.explanation.whyItFits,
      best_for: m.explanation.bestFor || null,
    };
  });
  const allExact = matched.every((x) => x.match_type === "exact");
  const opening = isAlternatives
    ? "I could not find an exact match, but I found close options that may still suit your requirement."
    : allExact
      ? "Here are options that suit your requirement:"
      : "Here are the closest options I found for you:";
  return [
    `USER = ${JSON.stringify({ name: name || null })}`,
    `OPENING = ${JSON.stringify(opening)}  // begin your reply with this exact line`,
    `MATCHED_PROPERTIES = ${JSON.stringify(matched, null, 2)}`,
    `DOCUMENT_CHUNKS = ${JSON.stringify(documentChunks ?? [], null, 2)}`,
  ].join("\n");
}

// Deterministic fallback phrasing (used when no LLM key is configured).
// Rotates a few warm acknowledgements so it doesn't read "Thank you" every turn.
function fallbackAsk(next, isFirstTurn, prefs) {
  const name = firstName(prefs);
  let opener;
  if (isFirstTurn) {
    opener = "Hello, and welcome to The Guardians. I'd be glad to help you find the right home. ";
  } else if (name) {
    const acks = [`Thank you, ${name}. `, `Great, ${name}. `, `Perfect, ${name}. `, `Noted, ${name}. `];
    opener = acks[next.slot.length % acks.length];
  } else {
    opener = "Thank you. ";
  }
  let q = next.question;
  if (next.secondQuestion) q += ` ${next.secondQuestion}`;
  return opener + q;
}

const MISSING = {
  price: "Price details are not available in my current data.",
  possession: "Possession details are not available in my current data.",
};

// Short framing only — the property details render as cards in the widget.
function fallbackRecommend(matches, isAlternatives, prefs) {
  const name = firstName(prefs);
  const who = name ? `, ${name}` : "";
  const opener = isAlternatives
    ? "I could not find an exact match, but I found close options that may still suit your requirement."
    : `Here are a few options that look like a strong fit${who}:`;
  return `${opener}\n\nWould you like me to arrange a site visit or a callback from our team?`;
}

// ---- main loop -------------------------------------------------------------
export async function handleChat({ sessionId, message, pageUrl }) {
  if (!sessionId || typeof sessionId !== "string") throw httpError(400, "sessionId is required");
  if (!message || !String(message).trim()) throw httpError(400, "message is required");

  await ensureSession(sessionId, pageUrl);

  const lead = await getLead(sessionId);
  const prefsBefore = lead?.prefs ?? {};
  const pendingSlot = firstMissingSlot(prefsBefore);
  const historyBefore = await getHistory(sessionId);
  const isFirstTurn = historyBefore.length === 0;

  await saveMessage(sessionId, "user", message);

  // Recent conversation in OpenAI format, including this turn — shared by the
  // extraction and phrasing calls so the model always sees what the user said.
  const llmHistory = [...toOpenAIHistory(historyBefore), { role: "user", content: message }];

  // 3. EXTRACT — the LLM understands the message; the deterministic heuristic
  // both backs it up offline and FILLS any slot the LLM left empty (a bare "no",
  // a single budget figure, an obvious BHK), which makes capture far more robust.
  let extracted = {};
  if (llmAvailable()) {
    try {
      const llm = await extractPreferences(llmHistory);
      if (llm && typeof llm === "object") extracted = llm;
    } catch (err) {
      console.error("[chat] extraction failed, using heuristic:", err.message);
    }
  }
  const heur = extractHeuristic(message, pendingSlot, prefsBefore);
  for (const [k, v] of Object.entries(heur)) {
    const cur = extracted[k];
    if ((cur === null || cur === undefined || cur === "") && v !== null && v !== undefined && v !== "") {
      extracted[k] = v;
    }
  }

  // 4. MERGE + validate, then persist prefs to the lead row.
  const prefs = mergePrefs(prefsBefore, extracted);

  // "a bedroom for each / individual bedrooms" means one bedroom per person, so
  // the configuration should match the household size — NOT a literal small
  // number like the "1" in "1 bedroom for each". This overrides any misparse.
  const wantsBedroomEach =
    /\b(individual|separate|own|personal)\s+bedrooms?\b/i.test(message) ||
    /\bbedrooms?\s+(?:for|per|to)\s+(?:each|every|all|everyone|us)\b/i.test(message) ||
    /\b(?:one|1|a)\s+bedrooms?\s+(?:for\s+)?(?:each|every|per)\b/i.test(message) ||
    /\beach\s+(?:of us\s+)?(?:gets?\s+)?(?:a|our|their|his|her)?\s*(?:own\s+)?bedrooms?\b/i.test(message);
  if (wantsBedroomEach && prefs.family_members) {
    prefs.bhk = `${prefs.family_members} BHK`;
  }

  if (prefs.phone != null) {
    if (isValidIndianPhone(prefs.phone)) prefs.phone = normalizePhone(prefs.phone);
    else delete prefs.phone; // invalid -> keep asking
  }
  if (prefs.email != null && !isValidEmail(prefs.email)) delete prefs.email;

  // Guard against a hallucinated budget: only keep budget figures if the user
  // actually mentioned money somewhere (a count of brothers/bedrooms is NOT a
  // budget). Phone numbers are excluded by requiring a money unit or ₹.
  const userSaid = [
    ...historyBefore.filter((m) => m.role === "user").map((m) => m.content),
    message,
  ]
    .join(" ")
    .toLowerCase();
  const mentionedMoney =
    /\b\d+(?:\.\d+)?\s*(?:crores?|cr|lakhs?|lacs?|k)\b/.test(userSaid) ||
    /₹\s*\d/.test(userSaid) ||
    /\bbudget\b/.test(userSaid);
  if (!mentionedMoney) {
    delete prefs.budget_min;
    delete prefs.budget_max;
  }

  // Infer residential vs commercial from context so we don't ask the obvious:
  // a family buying for self-use is residential; office/shop/retail is commercial.
  if (!prefs.property_type) {
    if (/\b(office|shop|retail|commercial|workspace|work space|showroom|warehouse|godown|co-?working|business premises)\b/.test(userSaid)) {
      prefs.property_type = "commercial";
    } else if (
      prefs.family_members != null ||
      prefs.has_children === true ||
      prefs.has_parents === true ||
      String(prefs.purpose).toLowerCase() === "self-use" ||
      /\b(family|wife|husband|spouse|kid|kids|child|children|son|daughter|parents|live|stay|home|house|bedroom|bhk|flat|apartment)\b/.test(userSaid)
    ) {
      prefs.property_type = "residential";
    }
  }

  // Budget: a single figure (e.g. "around 20 cr") becomes a ceiling with a
  // sensible floor, so suitable lower-priced homes still qualify as matches.
  // Explicit ranges ("2.8 to 3.5 cr") are kept exactly as given.
  const bmin = prefs.budget_min;
  const bmax = prefs.budget_max;
  if (bmin == null && bmax != null) prefs.budget_min = Math.round(bmax * 0.6);
  else if (bmax == null && bmin != null) {
    prefs.budget_max = bmin;
    prefs.budget_min = Math.round(bmin * 0.6);
  } else if (bmin != null && bmax != null && bmin === bmax) {
    prefs.budget_min = Math.round(bmax * 0.6);
  }

  const leadScore = scoreLead(prefs);
  await upsertLead(sessionId, prefs, leadScore);

  // 5. DECIDE next step deterministically.
  const next = nextQuestion(prefs);
  let reply;
  let mode;
  let recommendations = [];

  if (next) {
    mode = "ask";
    // Consultative nudge (personality.md): if the chosen config looks small for
    // the household, ask the advisor to gently educate and offer larger options
    // too — fired only on the turn the size info was just given.
    let advisorNote = null;
    const chosenBhk = bhkNumber(prefs.bhk);
    const targets = deriveTargetBHK(prefs);
    const justGaveSize = extracted.bhk != null || extracted.family_members != null;
    if (justGaveSize && chosenBhk != null && targets.length && chosenBhk < Math.min(...targets)) {
      advisorNote =
        `The customer wants a ${prefs.bhk} but mentioned ${prefs.family_members} people staying. ` +
        `Gently note that a ${prefs.bhk} may feel restrictive for them over time, and that you'd be ` +
        `glad to also show ${Math.min(...targets)}–${Math.max(...targets)} BHK options to compare — ` +
        `never insist or imply their choice is wrong.`;
    }
    // Warmth tapers: welcoming for the first couple of turns, then businesslike.
    const askCount = historyBefore.filter((m) => m.role === "assistant").length;
    const style =
      askCount <= 1
        ? "Tone: warm and welcoming."
        : "Tone: concise and businesslike now — at most a brief 3–7 word acknowledgement, then the question. No compliments, no exclamation marks, don't use their name this turn, and don't explain why you're asking.";
    reply =
      (llmAvailable() &&
        (await safePhrase(() =>
          phraseAsk({
            history: llmHistory,
            userName: firstName(prefs),
            nextQuestion: next.question,
            secondQuestion: next.secondQuestion,
            advisorNote,
            style,
          })
        ))) ||
      fallbackAsk(next, isFirstTurn, prefs);
  } else {
    const allProps = await loadProperties();
    const { isAlternatives, matches } = findRecommendations(prefs, allProps);
    mode = isAlternatives ? "alternatives" : "recommend";
    recommendations = matches.map(formatRecommendation);

    // DOCUMENT_CHUNKS get populated in Phase 5 (RAG).
    const documentChunks = await retrieveChunks(prefs, matches);
    const dataBlock = buildRecommendBlock(matches, isAlternatives, documentChunks, firstName(prefs));
    reply =
      (llmAvailable() &&
        (await safePhrase(() =>
          phraseRecommend({ history: llmHistory, userName: firstName(prefs), dataBlock })
        ))) ||
      fallbackRecommend(matches, isAlternatives, prefs);
  }

  // 7. Save reply, return.
  await saveMessage(sessionId, "assistant", reply);
  return { reply, mode, recommendations, leadScore, leadTier: leadTier(leadScore), prefs };
}

async function safePhrase(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error("[chat] phrasing failed, using fallback:", err.message);
    return null;
  }
}

// Retrieve top-k PDF chunks for the matched properties to ground phrasing.
async function retrieveChunks(prefs, matches) {
  try {
    const ids = matches.map((m) => m.property.id).filter(Boolean);
    if (!ids.length) return [];
    const queryText = [
      prefs.preferred_location,
      prefs.bhk,
      ...(Array.isArray(prefs.amenities) ? prefs.amenities : []),
      "amenities location highlights connectivity possession",
    ]
      .filter(Boolean)
      .join(" ");
    const chunks = await retrieveChunksForProperties(queryText, ids, 4);
    return chunks.map((c) => ({ text: c.text, score: Number(c.score.toFixed(3)) }));
  } catch (err) {
    console.error("[chat] chunk retrieval failed:", err.message);
    return [];
  }
}
