import { Router } from "express";
import { handleChat, getSessionMessages } from "../services/chat.service.js";
import { synthesizeSpeech, ttsAvailable } from "../services/openai.service.js";

const router = Router();

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
