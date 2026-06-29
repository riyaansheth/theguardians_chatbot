// Deterministic slot-filling order. The LLM never decides what to ask next.

export const QUESTION_ORDER = [
  ["name", "May I know your name?"],
  ["phone", "Could you share a phone number where The Guardians can reach you?"],
  ["purpose", "Are you looking at this for self-use, investment, or both?"],
  ["property_type", "Are you looking for residential or commercial?"],
  ["family_members", "How many family members would be staying here?"],
  ["has_parents", "Will your parents be staying with you?"],
  ["has_children", "Do you have children, or plan to, who would stay there?"],
  ["preferred_location", "Which area or location do you prefer?"],
  ["budget_min", "What budget range are you working with?"],
  ["bhk", "What configuration are you after — 1, 2, or 3 BHK?"],
];

// Slots that must be present before we recommend anything.
export const REQUIRED_SLOTS = [
  "purpose",
  "property_type",
  "family_members",
  "preferred_location",
  "budget_min",
  "bhk",
];

// Questions we can ask together with their primary (keeps it to one/two).
const PAIRED = { has_parents: "has_children" };

function isFilled(prefs, slot) {
  return prefs[slot] !== null && prefs[slot] !== undefined && prefs[slot] !== "";
}

export function firstMissingSlot(prefs) {
  for (const [slot] of QUESTION_ORDER) if (!isFilled(prefs, slot)) return slot;
  return null;
}

// Returns { slot, question, secondQuestion? } or null when everything is collected.
export function nextQuestion(prefs) {
  for (const [slot, question] of QUESTION_ORDER) {
    if (!isFilled(prefs, slot)) {
      const result = { slot, question };
      const pairSlot = PAIRED[slot];
      if (pairSlot && !isFilled(prefs, pairSlot)) {
        result.secondQuestion = QUESTION_ORDER.find(([s]) => s === pairSlot)?.[1];
      }
      return result;
    }
  }
  return null;
}

export function hasAllRequired(prefs) {
  return REQUIRED_SLOTS.every((s) => isFilled(prefs, s));
}
