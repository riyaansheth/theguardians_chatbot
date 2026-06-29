// Deterministic slot-filling order. The LLM never decides what to ask next.

// We only ask for the name; no contact details are requested. A phone is still
// captured if the customer volunteers it, but the bot never asks for it.
export const QUESTION_ORDER = [
  ["name", "May I know your name?"],
  ["purpose", "Are you looking at this for self-use, investment, or both?"],
  ["property_type", "Are you looking for residential or commercial?"],
  ["family_members", "How many family members would be staying here?"],
  ["has_parents", "Will your parents be staying with you?"],
  ["has_children", "Do you have children, or plan to, who would stay there?"],
  ["preferred_location", "Which area or location do you prefer?"],
  ["bhk", "What configuration are you after — 2, 3, 4 BHK, or something larger?"],
];

// Slots that must be present before we recommend anything. (Budget is omitted
// while the inventory has no prices; re-add "budget_min" once prices exist.)
export const REQUIRED_SLOTS = [
  "purpose",
  "property_type",
  "family_members",
  "preferred_location",
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
