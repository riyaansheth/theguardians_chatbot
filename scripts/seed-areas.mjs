// Generates realistic mock inventory across South Bombay -> Andheri.
// Pricing is derived from approximate real-world per-sq-ft rates per area.
// Idempotent: upserts on (project_name, micro_location), so re-running is safe.
import { query } from "../src/config/db.js";

// area: [min ₹/sqft, max ₹/sqft], micro-locations, nearby landmarks.
const AREAS = [
  { name: "Colaba",       rate: [60000, 90000],  micro: ["Colaba", "Apollo Bunder", "Colaba Causeway"], land: ["Gateway of India", "Colaba Causeway", "Hospitals nearby", "Sea view"] },
  { name: "Cuffe Parade", rate: [55000, 80000],  micro: ["Cuffe Parade", "Badhwar Park", "World Trade Centre"], land: ["World Trade Centre", "Sea view", "NMIMS", "Hospitals nearby"] },
  { name: "Churchgate",   rate: [60000, 95000],  micro: ["Churchgate", "Marine Drive", "Marine Lines"], land: ["Marine Drive", "Oval Maidan", "Churchgate Station", "Sea view"] },
  { name: "Malabar Hill", rate: [70000, 115000], micro: ["Malabar Hill", "Walkeshwar", "Napean Sea Road"], land: ["Hanging Gardens", "Sea view", "Banganga", "Hospitals nearby"] },
  { name: "Tardeo",       rate: [50000, 75000],  micro: ["Tardeo", "Mumbai Central", "Jacob Circle"], land: ["Bhatia Hospital", "Mumbai Central Station", "Malls", "Schools"] },
  { name: "Byculla",      rate: [33000, 52000],  micro: ["Byculla East", "Byculla West", "Mazgaon"], land: ["Byculla Station", "Jijamata Udyaan", "Hospitals nearby", "Schools"] },
  { name: "Mahalaxmi",    rate: [55000, 82000],  micro: ["Mahalaxmi", "Jacob Circle", "Haji Ali"], land: ["Mahalaxmi Racecourse", "Mahalaxmi Temple", "Sea view", "Hospitals nearby"] },
  { name: "Worli",        rate: [55000, 92000],  micro: ["Worli", "Worli Naka", "Worli Sea Face"], land: ["Worli Sea Face", "Bandra-Worli Sea Link", "Phoenix Palladium", "Hospitals nearby"] },
  { name: "Lower Parel",  rate: [45000, 72000],  micro: ["Lower Parel", "Senapati Bapat Marg", "Curry Road"], land: ["Phoenix Mills", "Kamala Mills", "Business district", "Schools"] },
  { name: "Prabhadevi",   rate: [50000, 80000],  micro: ["Prabhadevi", "Dadar West", "Century Bazaar"], land: ["Siddhivinayak Temple", "Sea view", "Dadar Station", "Schools"] },
  { name: "Dadar",        rate: [40000, 62000],  micro: ["Dadar East", "Dadar West", "Matunga"], land: ["Dadar Station", "Shivaji Park", "Markets", "Schools"] },
  { name: "Bandra West",  rate: [55000, 98000],  micro: ["Bandra West", "Pali Hill", "Bandstand", "Carter Road"], land: ["Bandstand", "Carter Road", "Linking Road", "Sea Link"] },
  { name: "Khar",         rate: [50000, 80000],  micro: ["Khar West", "Khar Danda", "Khar East"], land: ["Khar Station", "Linking Road", "Cafes", "Schools"] },
  { name: "Santacruz",    rate: [40000, 68000],  micro: ["Santacruz West", "Santacruz East", "Juhu Tara"], land: ["Domestic Airport", "Linking Road", "Schools", "Hospitals nearby"] },
  { name: "Vile Parle",   rate: [42000, 65000],  micro: ["Vile Parle West", "Vile Parle East", "Juhu Scheme"], land: ["Airport", "Mithibai College", "Markets", "Schools"] },
  { name: "Andheri West", rate: [28000, 47000],  micro: ["Andheri West", "Lokhandwala", "Versova", "Four Bungalows"], land: ["Versova Metro", "Lokhandwala Market", "Versova Beach", "Schools"] },
  { name: "Andheri East", rate: [22000, 40000],  micro: ["Andheri East", "Marol", "Chakala", "SEEPZ"], land: ["Metro Station", "SEEPZ", "MIDC", "International Airport"] },
];

// 6 configs per area (varied BHK + carpet) -> >=5 properties each.
const CONFIGS = [
  { bhk: "1 BHK", n: 1, carpet: 480 },
  { bhk: "2 BHK", n: 2, carpet: 760 },
  { bhk: "2 BHK", n: 2, carpet: 900 },
  { bhk: "3 BHK", n: 3, carpet: 1280 },
  { bhk: "3 BHK", n: 3, carpet: 1520 },
  { bhk: "4 BHK", n: 4, carpet: 2200 },
];

const DEVS = [
  "Lodha", "Oberoi Realty", "Godrej Properties", "Rustomjee", "Kalpataru",
  "Piramal Realty", "K Raheja Corp", "Hiranandani", "Wadhwa Group", "Sunteck Realty",
  "Mahindra Lifespaces", "L&T Realty", "Runwal", "Dosti Realty", "Ruparel Realty",
  "Sheth Realty", "Ajmera Group", "Marathon Group", "Adani Realty", "Birla Estates",
];
const TOWERS = [
  "Heights", "Residences", "Skyline", "Crest", "Vista", "Pinnacle", "Grandeur",
  "Eternia", "Atmosphere", "Bayview", "Skylux", "Trinity", "Imperial", "Aurum",
  "Element", "Serenity", "Avenue", "Parkside", "Altamount", "Signature", "Horizon", "Estate",
];
const AMENITIES = [
  "Lift", "Gymnasium", "Swimming Pool", "Clubhouse", "Landscaped Garden",
  "Children's Play Area", "24x7 Security", "Covered Parking", "Indoor Games",
  "Jogging Track", "Spa", "Sky Lounge", "Concierge", "EV Charging", "Banquet Hall",
];
const POSSESSION = [
  { status: "ready", date: "Ready to move" },
  { status: "under-construction", date: "Dec 2026" },
  { status: "under-construction", date: "Jun 2027" },
  { status: "under-construction", date: "Mar 2028" },
];

const round = (v, step) => Math.round(v / step) * step;
const cr = (v) => `₹${(v / 1e7).toFixed(2)} Cr`;

function suitableFor(n) {
  if (n === 1) return ["couple", "investment", "self-use"];
  if (n === 2) return ["small family", "self-use", "investment"];
  if (n === 3) return ["family", "children", "parents", "self-use"];
  return ["large family", "luxury", "children", "self-use"];
}

const UPSERT = `
INSERT INTO properties
  (project_name, developer_name, location, micro_location, city, property_type,
   bhk, configuration, min_price, max_price, price_text, carpet_area,
   possession_status, possession_date, rera_number, amenities, nearby_landmarks,
   suitable_for, source_file, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19, now())
ON CONFLICT (project_name, COALESCE(micro_location, '')) DO UPDATE SET
  min_price = EXCLUDED.min_price, max_price = EXCLUDED.max_price,
  price_text = EXCLUDED.price_text, possession_status = EXCLUDED.possession_status,
  possession_date = EXCLUDED.possession_date, amenities = EXCLUDED.amenities,
  updated_at = now()
RETURNING (xmax = 0) AS inserted;
`;

let inserted = 0;
let updated = 0;

for (let a = 0; a < AREAS.length; a++) {
  const area = AREAS[a];
  for (let j = 0; j < CONFIGS.length; j++) {
    const c = CONFIGS[j];
    const dev = DEVS[(a * 6 + j) % DEVS.length];
    const tower = TOWERS[(a * 5 + j * 3) % TOWERS.length];
    const project = `${dev.split(" ")[0]} ${tower}`;
    const micro = area.micro[j % area.micro.length];

    // property-specific rate within the area's band
    const frac = (j + 0.5) / CONFIGS.length;
    const rate = area.rate[0] + (area.rate[1] - area.rate[0]) * frac;
    const minP = round(c.carpet * rate * 0.96, 500000);
    const maxP = Math.max(minP + 500000, round(c.carpet * rate * 1.12, 500000));
    const priceText = `${cr(minP)} - ${cr(maxP)}`;

    const poss = POSSESSION[j % POSSESSION.length];
    const amenities = AMENITIES.slice(0, 7 + c.n); // bigger homes -> more amenities
    const rera = "P" + String(51900000000 + a * 1000 + j).slice(0, 11);

    const params = [
      project, dev, area.name, micro, "Mumbai", "residential",
      c.bhk, c.bhk, minP, maxP, priceText, `${c.carpet} sq.ft.`,
      poss.status, poss.date, rera,
      JSON.stringify(amenities), JSON.stringify(area.land),
      JSON.stringify(suitableFor(c.n)), "seed-areas",
    ];
    const res = await query(UPSERT, params);
    if (res.rows[0]?.inserted) inserted++;
    else updated++;
  }
}

const total = await query("SELECT count(*)::int AS n FROM properties");
console.log(`Done. Inserted ${inserted}, updated ${updated}. Total properties: ${total.rows[0].n}.`);
process.exit(0);
