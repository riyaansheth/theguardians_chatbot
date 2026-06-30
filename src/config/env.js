import dotenv from "dotenv";

dotenv.config();

/**
 * Reads and validates required environment variables at boot.
 * Throws immediately if anything required is missing, so the server
 * never starts in a half-configured state.
 */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const env = {
  port: Number(optional("PORT", "3000")),
  // Origins allowed to call /api/* from the browser widget (cross-origin).
  allowedOrigins: optional("ALLOWED_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  databaseUrl: required("DATABASE_URL"),

  openaiApiKey: required("OPENAI_API_KEY"),
  openaiChatModel: optional("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
  openaiEmbeddingModel: optional("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
  // gpt-4o-mini-tts supports steering the delivery via an instructions prompt.
  openaiTtsModel: optional("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
  // Voice for spoken replies: alloy | echo | fable | onyx | nova | shimmer.
  openaiTtsVoice: optional("OPENAI_TTS_VOICE", "onyx"),

  adminUser: optional("ADMIN_USER", "admin"),
  adminPassword: required("ADMIN_PASSWORD"),
};
