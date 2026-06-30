import { Router } from "express";
import { handleChat, getSessionMessages } from "../services/chat.service.js";

const router = Router();

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
