// External input validation. Phone = Indian 10-digit, email = standard regex.

export function normalizePhone(v) {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function isValidIndianPhone(v) {
  const ten = normalizePhone(v);
  return /^[6-9]\d{9}$/.test(ten);
}

export function isValidEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
