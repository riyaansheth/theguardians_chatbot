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
// The customer's first name (for personalization), or null.
function firstName(prefs) {
  return prefs && prefs.name ? String(prefs.name).trim().split(/\s+/)[0] : null;
}

function buildRecommendBlock(matches, isAlternatives, documentChunks, name) {
  const matched = matches.map((m) => {
    const p = m.property;
    return {
      project: p.project_name,
      area: p.micro_location ? `${p.micro_location}, ${p.location}` : p.location,
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

function fallbackRecommend(matches, isAlternatives, prefs) {
  const name = firstName(prefs);
  const lines = [];
  if (isAlternatives) {
    // Required opening line stays verbatim, then a warm personal touch.
    lines.push("I could not find an exact match, but I found close options that may still suit your requirement.");
    if (name) lines.push(`Here's what I'd recommend for you, ${name}:`);
  } else {
    lines.push(
      name
        ? `Based on everything you've shared, ${name}, here are options I think could suit you beautifully:`
        : "Based on what you've shared, here are options that may suit you:"
    );
  }
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
  lines.push(
    name
      ? `Would you like me to arrange a site visit or a callback from The Guardians team, ${name}?`
      : "Would you like to schedule a site visit or a callback from The Guardians team?"
  );
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
    /\b\d+(?:\.\d+)?\s*(?:crore|cr|lakh|lac|lacs|k)\b/.test(userSaid) ||
    /₹\s*\d/.test(userSaid) ||
    /\bbudget\b/.test(userSaid);
  if (!mentionedMoney) {
    delete prefs.budget_min;
    delete prefs.budget_max;
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
    reply =
      (llmAvailable() &&
        (await safePhrase(() =>
          phraseAsk({
            history: llmHistory,
            userName: firstName(prefs),
            nextQuestion: next.question,
            secondQuestion: next.secondQuestion,
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
