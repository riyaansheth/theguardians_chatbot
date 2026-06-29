import pg from "pg";
import { env } from "./env.js";

export const pool = new pg.Pool({ connectionString: env.databaseUrl });

export function query(text, params) {
  return pool.query(text, params);
}
