// PDF ingestion + embeddings for RAG.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { env } from "../config/env.js";
import { query } from "../config/db.js";

// FOOTGUN: import the lib's real file, NOT the package index — the index has a
// debug branch that reads a bundled test PDF and crashes at startup.
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const EMBED_DIM = 1536;

const keyLooksReal =
  typeof env.openaiApiKey === "string" &&
  env.openaiApiKey.startsWith("sk-") &&
  !env.openaiApiKey.includes("placeholder");
const client = keyLooksReal ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

export function embeddingsLive() {
  return client !== null;
}

export async function extractPdfText(filePath) {
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text || "";
}

// ~500-word chunks with light overlap (well within the 500-1000 token target).
export function chunkText(text, { size = 500, overlap = 60 } = {}) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + size).join(" "));
    if (i + size >= words.length) break;
    i += size - overlap;
  }
  return chunks;
}

// Deterministic offline embedding (used only without a real key) so the store
// + cosine-retrieval pipeline is exercisable locally. Shared words -> similar
// vectors, which is enough to demonstrate retrieval mechanically.
function hashEmbed(text) {
  const v = new Array(EMBED_DIM).fill(0);
  const tokens = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    v[Math.abs(h) % EMBED_DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export async function embedTexts(texts) {
  if (!client) return texts.map(hashEmbed);
  const res = await client.embeddings.create({
    model: env.openaiEmbeddingModel,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

function toVectorLiteral(arr) {
  return `[${arr.join(",")}]`;
}

// Fuzzy-link a PDF to a property by detecting a known project name in the text.
async function detectPropertyId(text) {
  const res = await query("SELECT id, project_name FROM properties");
  const low = text.toLowerCase();
  for (const row of res.rows) {
    if (row.project_name && low.includes(row.project_name.toLowerCase())) return row.id;
  }
  return null;
}

export async function ingestPdf(filePath, fileName, documentType = "brochure") {
  const text = await extractPdfText(filePath);
  const chunks = chunkText(text);
  if (!chunks.length) return { fileName, chunks: 0, propertyId: null, live: embeddingsLive() };

  const propertyId = await detectPropertyId(text);
  const vectors = await embedTexts(chunks);

  for (let i = 0; i < chunks.length; i++) {
    await query(
      `INSERT INTO property_documents (property_id, chunk_text, embedding, document_type, metadata)
       VALUES ($1, $2, $3::vector, $4, $5::jsonb)`,
      [
        propertyId,
        chunks[i],
        toVectorLiteral(vectors[i]),
        documentType,
        JSON.stringify({ source_file: fileName, chunk_index: i }),
      ]
    );
  }
  return { fileName, chunks: chunks.length, propertyId, live: embeddingsLive() };
}

// Top-k cosine retrieval, optionally scoped to a set of property ids.
export async function retrieveChunksForProperties(queryText, propertyIds, k = 4) {
  const [vec] = await embedTexts([queryText]);
  const ids = propertyIds && propertyIds.length ? propertyIds : null;
  const res = await query(
    `SELECT chunk_text, property_id, metadata, 1 - (embedding <=> $1::vector) AS score
       FROM property_documents
      WHERE ($2::int[] IS NULL OR property_id = ANY($2))
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [toVectorLiteral(vec), ids, k]
  );
  return res.rows.map((r) => ({
    text: r.chunk_text,
    property_id: r.property_id,
    score: Number(r.score),
  }));
}
