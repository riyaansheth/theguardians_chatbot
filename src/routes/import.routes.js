import { Router } from "express";
import multer from "multer";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";
import { extname } from "node:path";
import { importSpreadsheet, listProperties } from "../services/import.service.js";

const router = Router();

// Uploads go to the OS temp dir; we parse immediately then delete (disks are
// ephemeral on Render/Railway — never rely on the file surviving).
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const SPREADSHEET_EXT = new Set([".xlsx", ".xls", ".csv"]);

router.post("/import", upload.single("file"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name: 'file')." });

  const { path: tmpPath, originalname } = req.file;
  const ext = extname(originalname).toLowerCase();
  try {
    if (SPREADSHEET_EXT.has(ext)) {
      const result = await importSpreadsheet(tmpPath, originalname);
      return res.json({ ok: true, type: "spreadsheet", ...result });
    }
    // PDF ingestion is wired up in Phase 5.
    return res.status(415).json({ error: `Unsupported file type: ${ext || "unknown"}` });
  } catch (err) {
    return next(err);
  } finally {
    await unlink(tmpPath).catch(() => {});
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
