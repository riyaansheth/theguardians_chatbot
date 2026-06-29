// Single dispatch point for uploaded files: spreadsheets -> import,
// PDFs -> embedding ingestion. Reused by the API and admin routes.
import { extname } from "node:path";
import { importSpreadsheet } from "./import.service.js";
import { ingestPdf } from "./embedding.service.js";

const SPREADSHEET_EXT = new Set([".xlsx", ".xls", ".csv"]);

export async function processUpload(filePath, fileName) {
  const ext = extname(fileName).toLowerCase();
  if (SPREADSHEET_EXT.has(ext)) {
    return { type: "spreadsheet", ...(await importSpreadsheet(filePath, fileName)) };
  }
  if (ext === ".pdf") {
    return { type: "pdf", ...(await ingestPdf(filePath, fileName)) };
  }
  const err = new Error(`Unsupported file type: ${ext || "unknown"}`);
  err.status = 415;
  throw err;
}
