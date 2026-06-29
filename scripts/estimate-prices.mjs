// Fills INDICATIVE price ranges for every property, derived from approximate
// market per-sq-ft rates per area x typical carpet sizes per BHK config.
// These are estimates (labelled "(est.)") — not official prices.
import { query, pool } from "../src/config/db.js";

// Approx. ₹/sq.ft. (carpet) ranges by area.
const RATE = {
  dadar: [40000, 56000],
  powai: [27000, 38000],
  chembur: [27000, 40000],
  sion: [26000, 38000],
  ghatkopar: [24000, 35000],
  asalpha: [22000, 31000],
  bhandup: [19000, 28000],
  nahur: [18000, 26000],
  calangute: [14000, 26000],
  kadamba: [10000, 18000],
  goa: [12000, 22000],
};
const DEFAULT_RATE = [24000, 34000];

// Typical carpet area [low, high] sq.ft. by BHK.
const CARPET = {
  1: [420, 520],
  2: [680, 880],
  3: [1050, 1400],
  4: [1700, 2300],
  5: [2600, 3500],
};

const round = (v, step) => Math.round(v / step) * step;
const cr = (v) => (v / 1e7).toFixed(2);

function rateFor(loc) {
  const n = String(loc || "").toLowerCase();
  for (const k in RATE) if (n.includes(k)) return RATE[k];
  return DEFAULT_RATE;
}

function carpetFor(n) {
  if (CARPET[n]) return CARPET[n];
  const lo = CARPET[Math.floor(n)] || CARPET[3];
  const hi = CARPET[Math.ceil(n)] || CARPET[4];
  return [Math.round((lo[0] + hi[0]) / 2), Math.round((lo[1] + hi[1]) / 2)];
}

function configsFrom(type) {
  const nums = (String(type).match(/\b([1-5](?:\.5)?)\b/g) || []).map(Number).filter((n) => n >= 1 && n <= 5);
  return nums.length ? [...new Set(nums)].sort((a, b) => a - b) : null;
}

async function run() {
  const props = (await query("SELECT id, project_name, bhk, configuration, location, micro_location, property_type FROM properties")).rows;
  let updated = 0;
  for (const p of props) {
    const [rLow, rHigh] = rateFor(p.location || p.micro_location);
    const configs = configsFrom(p.bhk || p.configuration);

    let minP;
    let maxP;
    if (configs) {
      const small = configs[0];
      const large = configs[configs.length - 1];
      const cLow = carpetFor(small)[0];
      const cHigh = carpetFor(large)[1];
      minP = round(cLow * rLow, 500000);
      maxP = round(cHigh * rHigh, 500000);
    } else {
      // Commercial / no BHK — estimate an office-size band (400–1800 sq.ft.).
      minP = round(400 * rLow * 0.9, 500000);
      maxP = round(1800 * rHigh * 0.95, 500000);
    }
    maxP = Math.max(maxP, minP + 500000);
    const priceText = `₹${cr(minP)} - ₹${cr(maxP)} Cr (est.)`;

    await query(
      `UPDATE properties
         SET min_price=$2, max_price=$3, price_text=$4,
             metadata = COALESCE(metadata,'{}'::jsonb) || '{"price_estimated":true}'::jsonb,
             updated_at = now()
       WHERE id=$1`,
      [p.id, minP, maxP, priceText]
    );
    updated++;
  }
  console.log(`Updated indicative prices for ${updated} properties.`);
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
