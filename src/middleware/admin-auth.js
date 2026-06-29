import basicAuth from "express-basic-auth";
import { env } from "../config/env.js";

// Minimal gate for admin + write endpoints. Note: this is basic auth, not
// production-grade SSO (documented in the README).
export const adminAuth = basicAuth({
  users: { [env.adminUser]: env.adminPassword },
  challenge: true,
  realm: "TheGuardianAdmin",
});
