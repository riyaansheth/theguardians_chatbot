-- Mock seed data has been removed. Real inventory is imported from the client's
-- spreadsheet via `node scripts/import-guardians.mjs "<path to xlsx>"` (or the
-- admin upload). This file is intentionally a no-op so `npm run migrate` does
-- not reintroduce placeholder properties.
SELECT 1;
