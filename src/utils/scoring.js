// Pure scoring. No DB, no LLM. Deterministic and unit-testable.
import { norm, eq, locMatch, bhkNumber, asArray, clusterOf, coordOf, areaKm } from "./normalize.js";

// Two localities within this many km count as "nearby".
const NEAR_KM = 5;

// ---- Location ----
export function sameLocation(prefLoc, prop) {
  if (!prefLoc) return false;
  return locMatch(prefLoc, prop.location) || locMatch(prefLoc, prop.micro_location);
}

export function nearbyLocation(prefLoc, prop) {
  if (!prefLoc || sameLocation(prefLoc, prop)) return false;
  // Prefer real coordinate distance; fall back to clusters if coords unknown.
  const ca = coordOf(prefLoc);
  const cb = coordOf(prop.location) ?? coordOf(prop.micro_location);
  if (ca && cb) return areaKm(ca, cb) <= NEAR_KM;
  const a = clusterOf(prefLoc);
  const b = clusterOf(prop.location) ?? clusterOf(prop.micro_location);
  return a != null && a === b;
}

// ---- Budget: 25 full (overlap), 12 partial (within 15%), else 0 ----
export function budgetScore(budgetMin, budgetMax, prop) {
  const pmin = prop.min_price;
  const pmax = prop.max_price;
  if (pmin == null && pmax == null) return 0;
  const plo = pmin ?? pmax;
  const phi = pmax ?? pmin;

  const lo = budgetMin ?? 0;
  const hi = budgetMax ?? budgetMin ?? Infinity;
  if (lo === 0 && hi === Infinity) return 0; // no budget stated

  if (lo <= phi && plo <= hi) return 25; // ranges overlap
  const elo = lo * 0.85;
  const ehi = hi === Infinity ? Infinity : hi * 1.15;
  if (elo <= phi && plo <= ehi) return 12; // within ~15%
  return 0;
}

// ---- BHK / configuration: 20 exact, 10 within ±1 ----
export function bhkScore(prefBhk, prop) {
  const a = bhkNumber(prefBhk);
  const b = bhkNumber(prop.bhk ?? prop.configuration);
  if (a == null || b == null) return 0;
  if (a === b) return 20;
  if (Math.abs(a - b) === 1) return 10;
  return 0;
}

// ---- Possession ----
export function possessionMatch(pref, prop) {
  if (!pref) return false;
  const want = norm(pref);
  const have = norm(prop.possession_status);
  if (!have) return false;
  if (want === "ready") return have.includes("ready");
  if (want.includes("under") || want.includes("construction")) {
    return have.includes("under") || have.includes("construction");
  }
  return eq(pref, prop.possession_status);
}

// ---- Family logic ----
export function deriveTargetBHK(prefs) {
  const n = prefs.family_members;
  if (n != null) {
    if (n <= 2) return [1, 2];
    if (n <= 4) return [2, 3];
    return [3, 4];
  }
  const b = bhkNumber(prefs.bhk);
  return b != null ? [b] : [];
}

export function familySuitable(prefs, prop) {
  const targets = deriveTargetBHK(prefs);
  const b = bhkNumber(prop.bhk ?? prop.configuration);
  if (targets.length && b != null && !targets.includes(b)) return false;

  const hay = [...asArray(prop.amenities), ...asArray(prop.nearby_landmarks)]
    .map(norm)
    .join(" ");
  if (prefs.has_parents && !(hay.includes("lift") || hay.includes("hospital"))) return false;
  if (prefs.has_children && !(hay.includes("school") || hay.includes("play"))) return false;
  return true;
}

// Kid-relevant amenity keywords (used when the customer has children).
const CHILD_AMENITIES = [
  "kid", "children", "play area", "play", "pool", "garden", "park", "sports",
  "cricket", "basketball", "skating", "climbing", "badminton", "lawn", "theatre", "games",
];

// Bonus (0..8) for child-friendly amenities when the customer has children.
export function childAmenityScore(prefs, prop) {
  if (!prefs.has_children) return 0;
  const hay = asArray(prop.amenities).map(norm).join(" | ");
  if (!hay) return 0;
  let hits = 0;
  for (const k of CHILD_AMENITIES) if (hay.includes(k)) hits++;
  return Math.min(8, hits * 2);
}

// ---- Property score: 0..100 base (+ child-amenity bonus) ----
export function scoreProperty(prefs, prop) {
  let score = 0;
  // Location: 30
  if (sameLocation(prefs.preferred_location, prop)) score += 30;
  else if (nearbyLocation(prefs.preferred_location, prop)) score += 18;
  // Budget: 25
  score += budgetScore(prefs.budget_min, prefs.budget_max, prop);
  // BHK/config: 20 / 10
  score += bhkScore(prefs.bhk, prop);
  // Possession: 10
  if (possessionMatch(prefs.possession_preference, prop)) score += 10;
  // Property type: 10
  if (prefs.property_type && eq(prefs.property_type, prop.property_type)) score += 10;
  // Family suitability: 5
  if (familySuitable(prefs, prop)) score += 5;
  // Child-friendly amenities: up to 8 (helps rank kid-suitable projects first)
  score += childAmenityScore(prefs, prop);
  return score;
}

// ---- Lead score: 0..100 ----
export function scoreLead(prefs) {
  let s = 0;
  if (prefs.name && prefs.phone) s += 30;
  if (prefs.budget_min != null && prefs.budget_max != null) s += 20;
  if (prefs.preferred_location) s += 15;
  if (norm(prefs.possession_preference) === "ready") s += 15;
  if (prefs.site_visit_required || prefs.callback || prefs.preferred_callback_time) s += 20;
  return Math.min(100, s);
}

export function leadTier(score) {
  if (score < 30) return "low";
  if (score < 70) return "medium";
  return "high";
}
