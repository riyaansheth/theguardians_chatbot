// The chat loop. The LLM is NOT in charge: flow + matching are deterministic;
// the LLM only extracts slots and phrases grounded replies.
import { query } from "../config/db.js";
import {
  llmAvailable,
  extractPreferences,
  phraseReply,
  GROUNDED_PROMPT,
  ASK_SYSTEM,
} from "./openai.service.js";
import { findExactMatches, findAlternativeMatches } from "./matching.service.js";
import { retrieveChunksForProperties } from "./embedding.service.js";
import { firstMissingSlot, nextQuestion } from "../utils/questions.js";
import { scoreLead, leadTier } from "../utils/scoring.js";
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
    location: p.location,
    configuration: p.bhk || p.configuration || null,
    price_text: p.price_text || null,
    possession_status: p.possession_status || null,
    score: match.score,
    relaxation: match.relaxation ?? null,
    why_it_fits: match.explanation.whyItFits,
    best_for: match.explanation.bestFor,
  };
}

// Build the user-turn data block for the grounded phrasing call.
function buildRecommendBlock(matches, isAlternatives, documentChunks) {
  const matched = matches.map((m) => {
    const p = m.property;
    return {
      project: p.project_name,
      location: p.location,
      configuration: p.bhk || p.configuration || null,
      price: p.price_text || null,
      possession: p.possession_status || null,
      rera: p.rera_number || null,
      why_it_fits: m.explanation.whyItFits,
      best_for: m.explanation.bestFor || null,
    };
  });
  return [
    `RESULT_SET = ${isAlternatives ? "ALTERNATIVES" : "EXACT"}`,
    `MATCHED_PROPERTIES = ${JSON.stringify(matched, null, 2)}`,
    `DOCUMENT_CHUNKS = ${JSON.stringify(documentChunks ?? [], null, 2)}`,
  ].join("\n");
}

// Deterministic fallback phrasing (used when no LLM key is configured).
function fallbackAsk(next, isFirstTurn) {
  const opener = isFirstTurn
    ? "Hello, and welcome to The Guardians. I'd be glad to help you find the right home. "
    : "Thank you. ";
  let q = next.question;
  if (next.secondQuestion) q += ` ${next.secondQuestion}`;
  return opener + q;
}

const MISSING = {
  price: "Price details are not available in my current data.",
  possession: "Possession details are not available in my current data.",
};

function fallbackRecommend(matches, isAlternatives) {
  const lines = [];
  lines.push(
    isAlternatives
      ? "I could not find an exact match, but I found close options that may still suit your requirement."
      : "Based on what you've shared, here are options that may suit you:"
  );
  for (const m of matches) {
    const p = m.property;
    lines.push("");
    lines.push(`• ${p.project_name} — ${p.location}`);
    lines.push(`  Configuration: ${p.bhk || p.configuration || "—"}`);
    lines.push(`  Price: ${p.price_text || MISSING.price}`);
    lines.push(`  Possession: ${p.possession_status || MISSING.possession}`);
    lines.push(`  Why it fits: ${m.explanation.whyItFits}`);
    if (m.explanation.bestFor) lines.push(`  ${m.explanation.bestFor}`);
  }
  lines.push("");
  lines.push("Would you like to schedule a site visit or a callback from The Guardians team?");
  return lines.join("\n");
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

  // 3. EXTRACT — LLM as a parser; deterministic fallback when no key.
  let extracted = null;
  if (llmAvailable()) {
    try {
      const msgs = [...toOpenAIHistory(historyBefore), { role: "user", content: message }];
      extracted = await extractPreferences(msgs);
    } catch (err) {
      console.error("[chat] extraction failed, using fallback:", err.message);
    }
  }
  if (extracted === null) extracted = extractHeuristic(message, pendingSlot, prefsBefore);

  // 4. MERGE + validate, then persist prefs to the lead row.
  const prefs = mergePrefs(prefsBefore, extracted);
  if (prefs.phone != null) {
    if (isValidIndianPhone(prefs.phone)) prefs.phone = normalizePhone(prefs.phone);
    else delete prefs.phone; // invalid -> keep asking
  }
  if (prefs.email != null && !isValidEmail(prefs.email)) delete prefs.email;

  const leadScore = scoreLead(prefs);
  await upsertLead(sessionId, prefs, leadScore);

  // 5. DECIDE next step deterministically.
  const next = nextQuestion(prefs);
  let reply;
  let mode;
  let recommendations = [];

  if (next) {
    mode = "ask";
    const dataBlock = next.secondQuestion
      ? `NEXT_QUESTIONS = ["${next.question}", "${next.secondQuestion}"]`
      : `NEXT_QUESTION = "${next.question}"`;
    reply = (llmAvailable() && (await safePhrase(ASK_SYSTEM, dataBlock))) || fallbackAsk(next, isFirstTurn);
  } else {
    const allProps = await loadProperties();
    let matches = findExactMatches(prefs, allProps);
    let isAlternatives = false;
    if (matches.length === 0) {
      matches = findAlternativeMatches(prefs, allProps);
      isAlternatives = true;
    }
    mode = isAlternatives ? "alternatives" : "recommend";
    recommendations = matches.map(formatRecommendation);

    // DOCUMENT_CHUNKS get populated in Phase 5 (RAG).
    const documentChunks = await retrieveChunks(prefs, matches);
    const dataBlock = buildRecommendBlock(matches, isAlternatives, documentChunks);
    reply =
      (llmAvailable() && (await safePhrase(GROUNDED_PROMPT, dataBlock))) ||
      fallbackRecommend(matches, isAlternatives);
  }

  // 7. Save reply, return.
  await saveMessage(sessionId, "assistant", reply);
  return { reply, mode, recommendations, leadScore, leadTier: leadTier(leadScore), prefs };
}

async function safePhrase(system, dataBlock) {
  try {
    return await phraseReply(system, dataBlock);
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
