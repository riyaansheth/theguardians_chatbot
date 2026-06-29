// Spreadsheet import: parse xlsx/csv, auto-detect columns, upsert into properties.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import xlsx from "xlsx";
import Papa from "papaparse";
import { query } from "../config/db.js";
import { norm } from "../utils/normalize.js";

// Canonical field -> accepted header synonyms (compared case-insensitively).
const SYNONYMS = {
  project_name: ["project name", "property name", "project", "name"],
  developer_name: ["developer", "builder", "developer name"],
  location: ["location", "area", "locality"],
  micro_location: ["micro location", "micro-location", "sub location", "sublocation"],
  city: ["city"],
  property_type: ["property type", "prop type", "category", "segment"],
  bhk: ["bhk", "config", "configuration", "type", "unit type"],
  price_text: ["price", "budget", "price range", "cost", "rate"],
  min_price: ["min price", "minimum price", "price min", "starting price"],
  max_price: ["max price", "maximum price", "price max"],
  carpet_area: ["carpet area", "carpet", "area", "size", "sqft", "saleable area"],
  possession_status: ["possession status", "possession", "status"],
  possession_date: ["possession date", "possession by", "handover", "ready by"],
  rera_number: ["rera", "rera number", "rera no", "rera id"],
  amenities: ["amenities", "features", "facilities"],
};

// Build header(raw) -> canonical field map for a given set of headers.
function detectFieldMap(headers) {
  const map = {};
  for (const header of headers) {
    const h = norm(header);
    if (!h) continue;
    let matched = null;
    for (const [canonical, syns] of Object.entries(SYNONYMS)) {
      if (syns.includes(h)) {
        matched = canonical;
        break;
      }
    }
    // Looser containment pass for headers like "Project Name (Tower A)".
    if (!matched) {
      for (const [canonical, syns] of Object.entries(SYNONYMS)) {
        if (syns.some((s) => h.includes(s))) {
          matched = canonical;
          break;
        }
      }
    }
    map[header] = matched; // null => unmapped -> raw_data
  }
  return map;
}

// "₹2.80 Cr - ₹3.50 Cr" -> { min_price, max_price }. Heuristic but predictable.
function parsePriceText(text) {
  if (text == null || text === "") return { min_price: null, max_price: null };
  const re = /([\d.,]+)\s*(cr|crore|crores|lakh|lac|lacs|l)?/gi;
  const amounts = [];
  let m;
  while ((m = re.exec(String(text))) !== null) {
    const raw = m[1].replace(/,/g, "");
    let n = parseFloat(raw);
    if (!Number.isFinite(n) || n === 0) continue;
    const unit = (m[2] || "").toLowerCase();
    if (unit.startsWith("cr")) n *= 1e7;
    else if (unit.startsWith("lac") || unit.startsWith("lakh") || unit === "l") n *= 1e5;
    else if (n < 10000) n *= 1e7; // bare "2.8" -> assume crore
    amounts.push(Math.round(n));
  }
  if (amounts.length === 0) return { min_price: null, max_price: null };
  return { min_price: Math.min(...amounts), max_price: Math.max(...amounts) };
}

function parseAmenities(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Read rows (array of {header: value}) from an xlsx or csv file.
function readRows(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".csv") {
    const content = readFileSync(filePath, "utf8");
    const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
    return parsed.data;
  }
  // .xlsx / .xls
  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { defval: "" });
}

// Turn one raw spreadsheet row into a canonical property record.
function mapRow(row, fieldMap) {
  const out = { raw_data: {} };
  for (const [header, value] of Object.entries(row)) {
    const canonical = fieldMap[header];
    if (!canonical) {
      if (value !== "" && value != null) out.raw_data[header] = value;
      continue;
    }
    out[canonical] = value;
  }

  // Derive min/max price from a free-form price column if not given explicitly.
  if (out.min_price == null && out.max_price == null && out.price_text != null) {
    const parsed = parsePriceText(out.price_text);
    out.min_price = parsed.min_price;
    out.max_price = parsed.max_price;
  }
  out.amenities = parseAmenities(out.amenities);
  if (out.bhk != null && out.configuration == null) out.configuration = out.bhk;
  return out;
}

const UPSERT_SQL = `
INSERT INTO properties
  (project_name, developer_name, location, micro_location, city, property_type,
   bhk, configuration, min_price, max_price, price_text, carpet_area,
   possession_status, possession_date, rera_number, amenities, raw_data, source_file, updated_at)
VALUES
  ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18, now())
ON CONFLICT (project_name, COALESCE(micro_location, '')) DO UPDATE SET
  developer_name    = COALESCE(EXCLUDED.developer_name, properties.developer_name),
  location          = COALESCE(EXCLUDED.location, properties.location),
  city              = COALESCE(EXCLUDED.city, properties.city),
  property_type     = COALESCE(EXCLUDED.property_type, properties.property_type),
  bhk               = COALESCE(EXCLUDED.bhk, properties.bhk),
  configuration     = COALESCE(EXCLUDED.configuration, properties.configuration),
  min_price         = COALESCE(EXCLUDED.min_price, properties.min_price),
  max_price         = COALESCE(EXCLUDED.max_price, properties.max_price),
  price_text        = COALESCE(EXCLUDED.price_text, properties.price_text),
  carpet_area       = COALESCE(EXCLUDED.carpet_area, properties.carpet_area),
  possession_status = COALESCE(EXCLUDED.possession_status, properties.possession_status),
  possession_date   = COALESCE(EXCLUDED.possession_date, properties.possession_date),
  rera_number       = COALESCE(EXCLUDED.rera_number, properties.rera_number),
  amenities         = EXCLUDED.amenities,
  raw_data          = properties.raw_data || EXCLUDED.raw_data,
  source_file       = EXCLUDED.source_file,
  updated_at        = now()
RETURNING (xmax = 0) AS inserted;
`;

function val(v) {
  return v === "" || v === undefined ? null : v;
}

export async function importSpreadsheet(filePath, fileName) {
  const rows = readRows(filePath);
  if (!rows.length) {
    return { fileName, rows: 0, inserted: 0, updated: 0, skipped: 0, unmapped: [] };
  }

  const headers = Object.keys(rows[0]);
  const fieldMap = detectFieldMap(headers);
  const unmapped = headers.filter((h) => !fieldMap[h]);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const rec = mapRow(row, fieldMap);
    if (!rec.project_name || String(rec.project_name).trim() === "") {
      skipped++;
      continue;
    }
    const params = [
      val(rec.project_name), val(rec.developer_name), val(rec.location),
      val(rec.micro_location), val(rec.city), val(rec.property_type),
      val(rec.bhk), val(rec.configuration), val(rec.min_price), val(rec.max_price),
      val(rec.price_text), val(rec.carpet_area), val(rec.possession_status),
      val(rec.possession_date), val(rec.rera_number),
      JSON.stringify(rec.amenities ?? []), JSON.stringify(rec.raw_data ?? {}),
      fileName,
    ];
    const res = await query(UPSERT_SQL, params);
    if (res.rows[0]?.inserted) inserted++;
    else updated++;
  }

  return { fileName, rows: rows.length, inserted, updated, skipped, unmapped };
}

export async function listProperties() {
  const res = await query("SELECT * FROM properties ORDER BY id");
  return res.rows;
}
