// Offline, deterministic slot extractor used ONLY when no OpenAI key is set
// (local testing / degraded mode). With a real key, openai.service does this.
// It leans on the "pending slot" (the question we just asked) to interpret the
// reply, plus a few obvious global patterns.

function parseYesNo(low) {
  if (/\b(yes|yeah|yep|yup|sure|haan|ya|correct|right|definitely|of course)\b/.test(low)) return true;
  if (/\b(no|nope|nah|not really|won'?t|will not|none)\b/.test(low)) return false;
  return null;
}

// Parse INR amounts from text. "1.6 cr", "2.5-3 cr", "45 lakh", "2 cr".
function parseBudgetRange(text) {
  const cleaned = String(text).replace(/\d+\s*bhk/gi, " "); // don't read "2 BHK" as money
  const re = /([\d.,]+)\s*(cr|crore|crores|lakh|lac|lacs|l)?/gi;
  const amounts = [];
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const raw = m[1].replace(/,/g, "");
    let n = parseFloat(raw);
    if (!Number.isFinite(n) || n === 0) continue;
    const unit = (m[2] || "").toLowerCase();
    if (unit.startsWith("cr")) n *= 1e7;
    else if (unit.startsWith("lac") || unit.startsWith("lakh") || unit === "l") n *= 1e5;
    else if (n < 10000) n *= 1e7; // bare "2.5" -> assume crore
    else if (n < 100000) continue; // ignore stray small integers
    amounts.push(Math.round(n));
  }
  if (!amounts.length) return null;
  return { min: Math.min(...amounts), max: amounts.length > 1 ? Math.max(...amounts) : null };
}

// Words that are clearly not a name (greetings/filler) so "Hi there" isn't a name.
const NON_NAME = new Set([
  "hi", "hello", "hey", "hii", "yo", "namaste", "thanks", "thank", "you",
  "ok", "okay", "sure", "yes", "no", "there", "good", "morning", "evening",
  "afternoon", "please", "help", "looking", "want", "need",
]);

function cleanName(text) {
  const t = String(text)
    .replace(/\b(my name is|i am|i'?m|this is|name'?s|it'?s|call me)\b/gi, "")
    .replace(/[^A-Za-z\s.]/g, "")
    .trim();
  const words = t
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !NON_NAME.has(w.toLowerCase()))
    .slice(0, 3);
  if (!words.length) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function cleanLocation(text) {
  const t = String(text)
    .replace(/\b(i (?:prefer|want|like|am looking)|looking (?:in|at|for)|prefer|somewhere in|the area of|area|location|near|around)\b/gi, "")
    .replace(/[.?!]/g, "")
    .trim();
  return t || String(text).trim();
}

export function extractHeuristic(message, pendingSlot, prefs) {
  const out = {};
  const text = String(message).trim();
  const low = text.toLowerCase();

  // --- global opportunistic signals (apply regardless of pending slot) ---
  const bhkM = low.match(/(\d+)\s*(?:bhk|bed)/);
  if (bhkM) out.bhk = `${bhkM[1]} BHK`;

  if (/cr|crore|lakh|lac|budget|₹|rs\.?|price|\bcrore\b/.test(low)) {
    const b = parseBudgetRange(text);
    if (b) {
      out.budget_min = b.min;
      out.budget_max = b.max ?? b.min;
    }
  }

  if (/\bready\b|ready to move|ready-to-move/.test(low)) out.possession_preference = "ready";
  else if (/under[\s-]?construction|new launch|under const/.test(low))
    out.possession_preference = "under-construction";

  if (/\binvest(ment|ing)?\b/.test(low) && /\bboth\b/.test(low)) out.purpose = "both";
  else if (/\binvest(ment|ing)?\b/.test(low)) out.purpose = "investment";
  else if (/self[\s-]?use|to (?:stay|live)|own use|family use/.test(low)) out.purpose = "self-use";

  if (/\bcommercial\b|\boffice\b|\bshop\b/.test(low)) out.property_type = "commercial";
  else if (/\bresidential\b|\bhome\b|\bflat\b|\bapartment\b|\bhouse\b/.test(low))
    out.property_type = "residential";

  if (/site visit|visit the site|see the (?:property|flat|site)/.test(low)) out.site_visit_required = true;
  if (/call ?back|call me|phone me/.test(low)) out.callback = true;

  // --- pending-slot directed interpretation ---
  switch (pendingSlot) {
    case "name":
      if (out.name == null) out.name = cleanName(text);
      break;
    case "phone": {
      const digits = text.replace(/\D/g, "");
      if (digits.length >= 10) out.phone = digits;
      break;
    }
    case "purpose":
      if (out.purpose == null) {
        if (/both/.test(low)) out.purpose = "both";
        else if (/invest/.test(low)) out.purpose = "investment";
        else out.purpose = "self-use";
      }
      break;
    case "property_type":
      if (out.property_type == null)
        out.property_type = /commercial|office|shop/.test(low) ? "commercial" : "residential";
      break;
    case "family_members": {
      const n = low.match(/\d+/);
      if (n) out.family_members = parseInt(n[0], 10);
      else if (/alone|just me|myself|single|only me/.test(low)) out.family_members = 1;
      else if (/couple|two of us|me and my (?:wife|husband|partner|spouse)/.test(low))
        out.family_members = 2;
      break;
    }
    case "has_parents": {
      const yn = parseYesNo(low);
      if (yn !== null) out.has_parents = yn;
      break;
    }
    case "has_children": {
      const yn = parseYesNo(low);
      if (yn !== null) out.has_children = yn;
      break;
    }
    case "preferred_location":
      if (out.preferred_location == null) out.preferred_location = cleanLocation(text);
      break;
    case "budget_min": {
      const b = parseBudgetRange(text);
      if (b) {
        out.budget_min = b.min;
        out.budget_max = b.max ?? b.min;
      }
      break;
    }
    case "bhk":
      if (out.bhk == null) {
        const n = low.match(/\d+/);
        if (n) out.bhk = `${n[0]} BHK`;
      }
      break;
    default:
      break;
  }

  return out;
}
