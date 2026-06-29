// Pure normalization helpers. No DB, no LLM.

export function norm(s) {
  return (s == null ? "" : String(s)).toLowerCase().trim().replace(/\s+/g, " ");
}

// Truthy, case-insensitive equality (empty strings never match).
export function eq(a, b) {
  const na = norm(a);
  return na !== "" && na === norm(b);
}

// Loose containment match between two location-ish strings.
export function locMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

// First integer found in a value, e.g. "2 BHK" -> 2, "3.5" -> 3.
export function bhkNumber(v) {
  if (v == null) return null;
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

// Parse a positive number out of a price-ish value; null if none.
export function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// jsonb columns already arrive as arrays/objects via pg; be defensive anyway.
export function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [v];
    } catch {
      return [v];
    }
  }
  return [v];
}

// Mumbai-region location clusters used for "nearby" scoring.
const LOCATION_CLUSTERS = [
  ["byculla", "lower parel", "worli", "parel", "mahalaxmi", "prabhadevi", "dadar"],
  ["andheri", "jogeshwari", "goregaon", "versova", "vile parle", "borivali", "malad", "bandra", "khar", "santacruz"],
  ["chembur", "ghatkopar", "mulund", "vikhroli", "kurla", "wadala", "sion"],
  ["thane", "ghodbunder", "kolshet", "majiwada", "manpada"],
];

// Index of the cluster a location belongs to, or null.
export function clusterOf(loc) {
  const n = norm(loc);
  if (!n) return null;
  for (let i = 0; i < LOCATION_CLUSTERS.length; i++) {
    if (LOCATION_CLUSTERS[i].some((token) => n.includes(token) || token.includes(n))) {
      return i;
    }
  }
  return null;
}
