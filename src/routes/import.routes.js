import { Router } from "express";
import multer from "multer";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";
import { listProperties } from "../services/import.service.js";
import { processUpload } from "../services/upload.service.js";
import { adminAuth } from "../middleware/admin-auth.js";

const router = Router();

// Uploads go to the OS temp dir; we parse immediately then delete (disks are
// ephemeral on Render/Railway — never rely on the file surviving).
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// Writing data is gated; reading the catalogue is open.
router.post("/import", adminAuth, upload.single("file"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name: 'file')." });
  try {
    const result = await processUpload(req.file.path, req.file.originalname);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  } finally {
    await unlink(req.file.path).catch(() => {});
  }
});

router.get("/properties", async (req, res, next) => {
  try {
    res.json({ properties: await listProperties() });
  } catch (err) {
    next(err);
  }
});

export default router;
