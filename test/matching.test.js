import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findExactMatches,
  findAlternativeMatches,
  rankProperties,
} from "../src/services/matching.service.js";
import { scoreLead, leadTier, scoreProperty } from "../src/utils/scoring.js";

// A deterministic subset mirroring the seed data (jsonb columns as arrays).
const PROPS = [
  {
    id: 1, project_name: "Imperial Heights", location: "Byculla", micro_location: "Byculla East",
    property_type: "residential", bhk: "2 BHK", min_price: 28000000, max_price: 35000000,
    price_text: "₹2.80 Cr - ₹3.50 Cr", possession_status: "ready",
    amenities: ["Lift", "Gymnasium", "Swimming Pool"], nearby_landmarks: ["Hospital nearby"],
    suitable_for: ["small family", "self-use"],
  },
  {
    id: 3, project_name: "Lodha Park", location: "Lower Parel", micro_location: "Lower Parel",
    property_type: "residential", bhk: "3 BHK", min_price: 75000000, max_price: 95000000,
    price_text: "₹7.50 Cr - ₹9.50 Cr", possession_status: "ready",
    amenities: ["Play Area", "School in complex"], nearby_landmarks: ["International Schools"],
    suitable_for: ["large family", "children"],
  },
  {
    id: 5, project_name: "Oberoi Sky City", location: "Andheri", micro_location: "Borivali East",
    property_type: "residential", bhk: "2 BHK", min_price: 31000000, max_price: 38000000,
    price_text: "₹3.10 Cr - ₹3.80 Cr", possession_status: "ready",
    amenities: ["Play Area", "School in complex"], nearby_landmarks: ["Schools", "Hospital"],
    suitable_for: ["family", "children"],
  },
  {
    id: 6, project_name: "Andheri Crest", location: "Andheri", micro_location: "Andheri West",
    property_type: "residential", bhk: "3 BHK", min_price: 55000000, max_price: 68000000,
    price_text: "₹5.50 Cr - ₹6.80 Cr", possession_status: "under-construction",
    amenities: ["Play Area"], nearby_landmarks: ["Schools", "Hospital"],
    suitable_for: ["large family", "children"],
  },
];

test("exact match: Byculla 2BHK ready within budget scores >= 70 and ranks first", () => {
  const prefs = {
    preferred_location: "Byculla", budget_min: 28000000, budget_max: 36000000,
    bhk: "2 BHK", family_members: 2, possession_preference: "ready",
    property_type: "residential",
  };
  const exact = findExactMatches(prefs, PROPS);
  assert.ok(exact.length >= 1, "expected at least one exact match");
  assert.equal(exact[0].property.project_name, "Imperial Heights");
  assert.ok(exact[0].score >= 70, `score should be >=70, got ${exact[0].score}`);
  // It should be a perfect-ish fit: location+budget+bhk+possession+type+family.
  assert.equal(exact[0].score, 100);
  assert.ok(exact[0].explanation.whyItFits.length > 0);
});

test("no exact match -> alternatives returned, all below 70 with a relaxation note", () => {
  const prefs = {
    preferred_location: "Navi Mumbai", budget_min: 50000000, budget_max: 60000000,
    bhk: "4 BHK", possession_preference: "ready", property_type: "residential",
  };
  const exact = findExactMatches(prefs, PROPS);
  assert.equal(exact.length, 0, "should find no exact matches");

  const alts = findAlternativeMatches(prefs, PROPS);
  assert.ok(alts.length > 0, "should propose alternatives");
  for (const a of alts) {
    assert.ok(a.score < 70, `alternative score should be <70, got ${a.score}`);
    assert.ok(typeof a.relaxation === "string" && a.relaxation.length > 0);
  }
});

test("bhk ±1 scores 10, exact scores 20 via scoreProperty", () => {
  const base = { preferred_location: "Andheri", budget_min: 31000000, budget_max: 38000000 };
  const exactBhk = scoreProperty({ ...base, bhk: "2 BHK" }, PROPS[2]); // Oberoi 2BHK
  const offByOne = scoreProperty({ ...base, bhk: "3 BHK" }, PROPS[2]);
  assert.ok(exactBhk > offByOne, "exact BHK should outscore ±1 BHK");
});

test("ranking is sorted descending by score", () => {
  const prefs = { preferred_location: "Andheri", bhk: "2 BHK", property_type: "residential" };
  const ranked = rankProperties(prefs, PROPS);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, "not sorted descending");
  }
});

test("lead scoring and tiers", () => {
  assert.equal(scoreLead({}), 0);
  assert.equal(leadTier(scoreLead({})), "low");

  const hot = scoreLead({
    name: "Asha", phone: "9820012345",
    budget_min: 20000000, budget_max: 30000000,
    preferred_location: "Thane", possession_preference: "ready",
    site_visit_required: true,
  });
  assert.equal(hot, 100); // 30 + 20 + 15 + 15 + 20
  assert.equal(leadTier(hot), "high");

  const warm = scoreLead({ preferred_location: "Thane", budget_min: 1, budget_max: 2 });
  assert.equal(leadTier(warm), "medium"); // 15 + 20 = 35
});
