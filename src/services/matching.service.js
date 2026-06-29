// Deterministic matching over property rows. No LLM here.
// The DB query lives in the caller; these functions take plain rows.
import { asArray } from "../utils/normalize.js";
import {
  scoreProperty,
  sameLocation,
  nearbyLocation,
  budgetScore,
  bhkScore,
  possessionMatch,
} from "../utils/scoring.js";

const EXACT_THRESHOLD = 70;

export function rankProperties(prefs, props) {
  return props
    .map((property) => ({ property, score: scoreProperty(prefs, property) }))
    .sort((a, b) => b.score - a.score);
}

// Score all, keep >= 70, top 3.
export function findExactMatches(prefs, props) {
  return rankProperties(prefs, props)
    .filter((r) => r.score >= EXACT_THRESHOLD)
    .slice(0, 3)
    .map((r) => ({ ...r, explanation: explainMatch(prefs, r.property) }));
}

// Single entry point used by the chat loop. Always surfaces up to `limit`
// options: exact matches (>=70) plus the closest near-misses to top up, each
// tagged isExact. Falls back to best-available when nothing is exact.
export function findRecommendations(prefs, props, limit = 3) {
  const ranked = rankProperties(prefs, props);

  // If the customer named a location, only offer same/nearby-area properties, so
  // we never pad the list with a far-flung area (e.g. Powai for a Worli request).
  // Fall back to all options only when nothing local exists at all.
  let pool = ranked;
  if (prefs.preferred_location) {
    const local = ranked.filter(
      (r) =>
        sameLocation(prefs.preferred_location, r.property) ||
        nearbyLocation(prefs.preferred_location, r.property)
    );
    if (local.length) pool = local;
  }

  const hasExact = pool.some((r) => r.score >= EXACT_THRESHOLD);
  const candidates = hasExact
    ? pool.filter((r) => r.score >= 55) // exact + genuinely close
    : pool.filter((r) => r.score > 0); // best available
  const matches = candidates.slice(0, limit).map((r) => ({
    ...r,
    isExact: r.score >= EXACT_THRESHOLD,
    relaxation: r.score >= EXACT_THRESHOLD ? null : relaxationReason(prefs, r.property),
    explanation: explainMatch(prefs, r.property),
  }));
  return { isAlternatives: !hasExact, matches };
}

// When no exact match: best 3 below threshold, each tagged with what we relaxed.
export function findAlternativeMatches(prefs, props) {
  return rankProperties(prefs, props)
    .filter((r) => r.score < EXACT_THRESHOLD)
    .slice(0, 3)
    .map((r) => ({
      ...r,
      relaxation: relaxationReason(prefs, r.property),
      explanation: explainMatch(prefs, r.property),
    }));
}

// Which constraint did we have to loosen, in spec priority order.
function relaxationReason(prefs, prop) {
  if (prefs.preferred_location && !sameLocation(prefs.preferred_location, prop)) {
    return nearbyLocation(prefs.preferred_location, prop)
      ? "a nearby location"
      : "a different location";
  }
  if (budgetScore(prefs.budget_min, prefs.budget_max, prop) < 25) {
    return "a slightly different budget";
  }
  if (bhkScore(prefs.bhk, prop) < 20) {
    return "a different configuration";
  }
  if (prefs.possession_preference && !possessionMatch(prefs.possession_preference, prop)) {
    return "a different possession timeline";
  }
  return "a close alternative";
}

// "Why it fits" + "Best for" — built ONLY from the property's real fields.
export function explainMatch(prefs, prop) {
  const why = [];
  if (sameLocation(prefs.preferred_location, prop)) {
    why.push(`Located in ${prop.location}, matching your preferred area`);
  } else if (nearbyLocation(prefs.preferred_location, prop)) {
    why.push(`Close to your preferred area, in ${prop.location}`);
  }
  if (budgetScore(prefs.budget_min, prefs.budget_max, prop) >= 25 && prop.price_text) {
    why.push(`Priced ${prop.price_text}, within your budget`);
  }
  if (bhkScore(prefs.bhk, prop) >= 20 && prop.bhk) {
    why.push(`${prop.bhk} configuration as requested`);
  }
  if (possessionMatch(prefs.possession_preference, prop)) {
    why.push(
      prop.possession_status === "ready"
        ? "Ready to move in"
        : "Under construction, as you preferred"
    );
  }
  const amenities = asArray(prop.amenities);
  if (amenities.length) {
    why.push(`Amenities include ${amenities.slice(0, 3).join(", ")}`);
  }

  const bestFor = asArray(prop.suitable_for);
  return {
    whyItFits: why.length ? `${why.join(". ")}.` : "Matches several of your stated requirements.",
    bestFor: bestFor.length ? `Best for ${bestFor.join(", ")}.` : "",
  };
}
