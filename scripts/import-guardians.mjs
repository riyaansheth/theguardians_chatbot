// One-off import of the real Guardians project list (Sheet1 of the client's
// "Guardians Inside Page Details.xlsx"). Clears existing properties first.
// Usage: node scripts/import-guardians.mjs "/path/to/Guardians Inside Page Details.xlsx"
import xlsx from "xlsx";
import { query, pool } from "../src/config/db.js";

const FILE =
  process.argv[2] ||
  "/Users/riyaansheth/DizruptWork/theguardians/Guardians Inside Page Details.xlsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const KNOWN_AREAS = [
  "chembur", "ghatkopar", "powai", "bhandup", "nahur", "sion", "dadar", "jogeshwari",
  "vikhroli", "mulund", "kanjurmarg", "chanivali", "asalpha", "kurla", "wadala",
  "calangute", "kadamba", "goa", "bandra", "andheri", "worli", "lower parel", "byculla", "thane",
];

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function primaryArea(raw) {
  const low = raw.toLowerCase();
  for (const a of KNOWN_AREAS) if (low.includes(a)) return titleCase(a);
  const first = raw.split(/[,(]/)[0].trim();
  return first || raw.trim() || null;
}

function fmtCompleted(v) {
  if (v instanceof Date && !isNaN(v)) return `${MONTHS[v.getMonth()]} ${v.getFullYear()}`;
  const s = clean(v);
  return s || null;
}

function isFuture(v) {
  if (v instanceof Date && !isNaN(v)) return v.getTime() > Date.now();
  return /20(2[6-9]|3\d)/.test(clean(v)); // a future year mentioned in text
}

const isCommercial = (type, name) =>
  /office|retail|commercial|boutique|business club/i.test(`${type} ${name}`);

function splitList(v) {
  return clean(v)
    .split(/[,;\n•|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const UPSERT = `
INSERT INTO properties
  (project_name, developer_name, location, micro_location, city, property_type,
   bhk, configuration, carpet_area, possession_status, possession_date, rera_number,
   amenities, nearby_landmarks, metadata, source_file, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16, now())
ON CONFLICT (project_name, COALESCE(micro_location, '')) DO UPDATE SET
  developer_name=EXCLUDED.developer_name, location=EXCLUDED.location,
  property_type=EXCLUDED.property_type, bhk=EXCLUDED.bhk, configuration=EXCLUDED.configuration,
  carpet_area=EXCLUDED.carpet_area, possession_status=EXCLUDED.possession_status,
  possession_date=EXCLUDED.possession_date, rera_number=EXCLUDED.rera_number,
  amenities=EXCLUDED.amenities, nearby_landmarks=EXCLUDED.nearby_landmarks,
  metadata=EXCLUDED.metadata, source_file=EXCLUDED.source_file, updated_at=now();
`;

async function run() {
  const wb = xlsx.readFile(FILE, { cellDates: true });
  const rows = xlsx.utils.sheet_to_json(wb.Sheets["Sheet1"], { defval: "" });

  console.log("Clearing existing properties + document chunks...");
  await query("TRUNCATE property_documents, properties RESTART IDENTITY CASCADE;");

  let imported = 0;
  const skipped = [];
  for (const r of rows) {
    const name = clean(r["Name of the Project"]);
    if (!name || /lorem ipsum/i.test(name)) {
      if (name) skipped.push(name);
      continue;
    }
    const type = clean(r["Type"]);
    const locRaw = clean(r["Location"]);
    const completed = r["Project completed in"];
    const city = /goa/i.test(locRaw) ? "Goa" : "Mumbai";

    const params = [
      name,
      clean(r["Builder Name"]) || null,
      locRaw ? primaryArea(locRaw) : null,
      locRaw || null,
      city,
      isCommercial(type, name) ? "commercial" : "residential",
      type || null,
      type || null,
      clean(r["Area"]) || null,
      isFuture(completed) ? "under-construction" : completed ? "ready" : null,
      fmtCompleted(completed),
      clean(r["RERA Number"]) || null,
      JSON.stringify(splitList(r["Project Amenities"])),
      JSON.stringify(splitList(r["Location + mode of transport + Time"]).slice(0, 8)),
      JSON.stringify({
        description: clean(r["Short description of property (30-50) words"]) || null,
        banner_image: clean(r["Banner Image link"]) || null,
        gallery_image: clean(r["Gallery image link"]) || null,
      }),
      "guardians-inside-page",
    ];
    await query(UPSERT, params);
    imported++;
  }

  const total = (await query("SELECT count(*)::int AS n FROM properties")).rows[0].n;
  console.log(`Imported ${imported} projects. Skipped placeholders: ${skipped.join(", ") || "none"}.`);
  console.log(`Total properties now: ${total}.`);
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
