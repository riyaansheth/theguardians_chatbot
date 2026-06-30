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

// Mumbai-region location clusters used for "nearby" scoring. Grouped so that
// adjacent localities (and a parent area's sub-localities) count as nearby.
const LOCATION_CLUSTERS = [
  // South Mumbai — tip
  ["colaba", "cuffe parade", "churchgate", "marine drive", "marine lines", "nariman point", "fort", "badhwar park", "apollo bunder", "fountain"],
  // South Mumbai — hill / sea
  ["malabar hill", "walkeshwar", "napean sea road", "breach candy", "kemps corner", "altamount", "peddar road"],
  // Central South Mumbai
  ["tardeo", "mumbai central", "jacob circle", "haji ali", "mahalaxmi", "worli", "worli naka", "worli sea face", "lower parel", "prabhadevi", "parel", "byculla", "mazgaon", "dadar", "matunga", "century bazaar"],
  // Western suburbs — inner
  ["bandra", "pali hill", "bandstand", "carter road", "khar", "khar danda", "santacruz", "vile parle", "juhu", "juhu tara"],
  // Western suburbs — Andheri belt
  ["andheri", "jogeshwari", "goregaon", "versova", "lokhandwala", "four bungalows", "malad", "borivali", "marol", "chakala", "seepz"],
  // Central / eastern suburbs (incl. Powai / LBS belt)
  ["chembur", "ghatkopar", "mulund", "vikhroli", "kurla", "wadala", "sion", "powai", "bhandup", "nahur", "kanjurmarg", "chanivali", "asalpha"],
  // Thane
  ["thane", "ghodbunder", "kolshet", "majiwada", "manpada"],
  // Goa
  ["goa", "calangute", "kadamba", "panaji", "mapusa", "candolim"],
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

// Approximate [lat, lng] for Mumbai-region localities (all three rail lines +
// SoBo + Navi Mumbai + Thane, plus Goa). Used for real "nearby" and "closest
// area" calculations. Coarse but good enough for relative proximity.
const AREA_COORDS = {
  // South Mumbai
  "colaba": [18.906, 72.815], "cuffe parade": [18.910, 72.810], "nariman point": [18.925, 72.824],
  "fort": [18.934, 72.836], "churchgate": [18.932, 72.827], "marine lines": [18.943, 72.823],
  "marine drive": [18.943, 72.823], "charni road": [18.951, 72.819], "girgaon": [18.954, 72.818],
  "grant road": [18.961, 72.815], "malabar hill": [18.955, 72.795], "walkeshwar": [18.948, 72.793],
  "napean sea road": [18.962, 72.802], "breach candy": [18.967, 72.805], "kemps corner": [18.965, 72.808],
  "tardeo": [18.969, 72.812], "mumbai central": [18.971, 72.820], "mahalaxmi": [18.982, 72.820],
  "haji ali": [18.978, 72.810], "worli": [19.000, 72.817], "lower parel": [18.997, 72.830],
  "prabhadevi": [19.013, 72.828], "parel": [18.998, 72.840], "byculla": [18.976, 72.832],
  "mazgaon": [18.965, 72.842], "dadar": [19.018, 72.844], "matunga": [19.027, 72.852],
  "mahim": [19.041, 72.840], "sion": [19.039, 72.862], "wadala": [19.018, 72.866],
  // Western suburbs
  "bandra": [19.060, 72.836], "bandra kurla": [19.066, 72.868], "bkc": [19.066, 72.868],
  "khar": [19.070, 72.838], "santacruz": [19.081, 72.841], "vile parle": [19.099, 72.844],
  "juhu": [19.107, 72.826], "andheri": [19.119, 72.847], "versova": [19.130, 72.815],
  "lokhandwala": [19.140, 72.825], "jogeshwari": [19.135, 72.849], "goregaon": [19.164, 72.849],
  "malad": [19.186, 72.848], "kandivali": [19.204, 72.852], "borivali": [19.229, 72.857],
  "dahisar": [19.250, 72.860], "mira road": [19.284, 72.870], "bhayander": [19.301, 72.851],
  // Central / eastern suburbs
  "kurla": [19.065, 72.879], "vidyavihar": [19.078, 72.897], "ghatkopar": [19.086, 72.908],
  "vikhroli": [19.110, 72.926], "kanjurmarg": [19.129, 72.936], "bhandup": [19.144, 72.936],
  "nahur": [19.155, 72.940], "mulund": [19.172, 72.956], "powai": [19.119, 72.905],
  "chanivali": [19.115, 72.900], "hiranandani": [19.118, 72.908], "asalpha": [19.092, 72.898],
  // Harbour / Navi Mumbai
  "chembur": [19.062, 72.900], "govandi": [19.054, 72.916], "mankhurd": [19.048, 72.930],
  "vashi": [19.077, 72.998], "sanpada": [19.063, 73.012], "nerul": [19.033, 73.018],
  "belapur": [19.022, 73.040], "kharghar": [19.047, 73.069], "panvel": [18.989, 73.117],
  "navi mumbai": [19.050, 73.020],
  // Thane
  "thane": [19.197, 72.972], "ghodbunder": [19.260, 72.978], "kolshet": [19.230, 72.975],
  "majiwada": [19.210, 72.975], "manpada": [19.235, 72.970], "naupada": [19.190, 72.965],
  // Region aliases
  "south bombay": [18.930, 72.830], "south mumbai": [18.930, 72.830], "sobo": [18.930, 72.830],
  "town": [18.930, 72.830], "western suburbs": [19.130, 72.847], "central suburbs": [19.110, 72.910],
  // Goa
  "goa": [15.500, 73.950], "calangute": [15.544, 73.755], "candolim": [15.518, 73.762],
  "kadamba": [15.500, 73.950], "panaji": [15.498, 73.827], "mapusa": [15.591, 73.809], "margao": [15.283, 73.985],
};

const AREA_TOKENS = Object.keys(AREA_COORDS);

// Bounded Levenshtein edit distance.
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

// Resolve a (possibly misspelled) location string to a known area token, or null.
// Exact substring first; then a fuzzy match so "dadr"->dadar, "powaii"->powai.
export function canonicalArea(loc) {
  const n = norm(loc);
  if (!n) return null;
  let best = null;
  let bestLen = 0;
  for (const t of AREA_TOKENS) {
    if (n.includes(t) && t.length > bestLen) {
      best = t;
      bestLen = t.length;
    }
  }
  if (best) return best;

  const words = n.split(/[^a-z]+/).filter((w) => w.length >= 3);
  let bestTok = null;
  let bestScore = [3, 0]; // [distance asc, token length desc]
  for (const w of words) {
    for (const t of AREA_TOKENS) {
      const thr = t.length <= 4 ? 1 : 2;
      if (Math.abs(t.length - w.length) > thr) continue;
      const d = editDistance(w, t);
      if (d <= thr && (d < bestScore[0] || (d === bestScore[0] && t.length > bestScore[1]))) {
        bestScore = [d, t.length];
        bestTok = t;
      }
    }
  }
  return bestTok;
}

// [lat, lng] for a location string (typo-tolerant), or null.
export function coordOf(loc) {
  const t = canonicalArea(loc);
  return t ? AREA_COORDS[t] : null;
}

// Approximate straight-line distance in km between two [lat, lng] pairs.
// Large finite value when either is unknown (keeps sorts well-defined).
export function areaKm(a, b) {
  if (!a || !b) return 9999;
  const dLat = (a[0] - b[0]) * 111;
  const dLng = (a[1] - b[1]) * 105; // ~cos(19°) * 111
  return Math.sqrt(dLat * dLat + dLng * dLng);
}
