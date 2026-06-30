import { Router } from "express";
import multer from "multer";
import { Readable } from "node:stream";
import { handleChat, getSessionMessages } from "../services/chat.service.js";
import { synthesizeSpeech, streamSpeech, ttsAvailable, transcribeAudio } from "../services/openai.service.js";

const router = Router();
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// POST /api/transcribe (multipart 'audio') -> { text } via Whisper
router.post("/transcribe", audioUpload.single("audio"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "audio is required" });
    const text = await transcribeAudio(req.file.buffer, req.file.originalname || "speech.webm");
    res.json({ text });
  } catch (err) {
    next(err);
  }
});

// POST /api/tts { text, voice? } -> mp3 audio, a natural human voice for replies
router.post("/tts", async (req, res, next) => {
  try {
    const text = (req.body?.text ?? "").toString().trim();
    if (!text) return res.status(400).json({ error: "text is required" });
    if (!ttsAvailable()) return res.status(503).json({ error: "voice not available" });
    const audio = await synthesizeSpeech(text, req.body?.voice);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audio);
  } catch (err) {
    next(err);
  }
});

// GET /api/tts?text=... -> streamed audio, so playback starts almost immediately.
router.get("/tts", async (req, res, next) => {
  try {
    const text = (req.query.text ?? "").toString().trim();
    if (!text) return res.status(400).json({ error: "text is required" });
    if (!ttsAvailable()) return res.status(503).json({ error: "voice not available" });
    const response = await streamSpeech(text, req.query.voice);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    const body = response && response.body;
    if (body && typeof body.pipe === "function") {
      body.pipe(res); // Node stream (OpenAI SDK)
    } else if (body && typeof body.getReader === "function") {
      Readable.fromWeb(body).pipe(res); // Web ReadableStream
    } else {
      res.send(Buffer.from(await response.arrayBuffer()));
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/chat  { sessionId, message, pageUrl }
router.post("/chat", async (req, res, next) => {
  try {
    const { sessionId, message, pageUrl } = req.body ?? {};
    const result = await handleChat({ sessionId, message, pageUrl });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/session/:id  -> transcript, so the widget can restore after a refresh
router.get("/session/:id", async (req, res, next) => {
  try {
    res.json({ messages: await getSessionMessages(req.params.id) });
  } catch (err) {
    next(err);
  }
});

export default router;
