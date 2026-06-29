import { Router } from "express";
import multer from "multer";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../config/db.js";
import { processUpload } from "../services/upload.service.js";
import { adminAuth } from "../middleware/admin-auth.js";

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: tmpdir(), limits: { fileSize: 25 * 1024 * 1024 } });

// Everything under /admin requires basic auth.
router.use(adminAuth);

// Admin SPA.
router.get("/", (req, res) => {
  res.sendFile(join(__dirname, "..", "..", "views", "admin.html"));
});

// Upload Excel / CSV / PDF.
router.post("/import", upload.single("file"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name: 'file')." });
  try {
    res.json({ ok: true, ...(await processUpload(req.file.path, req.file.originalname)) });
  } catch (err) {
    next(err);
  } finally {
    await unlink(req.file.path).catch(() => {});
  }
});

router.get("/properties", async (req, res, next) => {
  try {
    const r = await query(
      `SELECT id, project_name, developer_name, location, micro_location, city, bhk,
              price_text, possession_status, source_file, updated_at
         FROM properties ORDER BY id`
    );
    res.json({ properties: r.rows });
  } catch (err) {
    next(err);
  }
});

router.delete("/properties/:id", async (req, res, next) => {
  try {
    await query("DELETE FROM properties WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/leads", async (req, res, next) => {
  try {
    const r = await query(
      `SELECT id, session_id, name, phone, email, lead_score, status, updated_at,
              prefs->>'preferred_location' AS location, prefs->>'bhk' AS bhk
         FROM leads ORDER BY lead_score DESC, updated_at DESC`
    );
    res.json({ leads: r.rows });
  } catch (err) {
    next(err);
  }
});

router.get("/sessions", async (req, res, next) => {
  try {
    const r = await query(
      `SELECT s.id, s.page_url, s.created_at, COUNT(m.id)::int AS messages
         FROM chat_sessions s
         LEFT JOIN messages m ON m.session_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at DESC`
    );
    res.json({ sessions: r.rows });
  } catch (err) {
    next(err);
  }
});

router.get("/sessions/:id/messages", async (req, res, next) => {
  try {
    const r = await query(
      `SELECT role, content, created_at FROM messages
        WHERE session_id = $1 ORDER BY created_at, id`,
      [req.params.id]
    );
    res.json({ messages: r.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
