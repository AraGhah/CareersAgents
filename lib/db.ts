import { config } from "dotenv";
import { Pool } from "pg";

// Next loads .env.local on its own, the tsx scripts do not.
config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Copy .env.example to .env.local.");
}

// Dev hot reload re-evaluates modules, so keep the pool on globalThis or we leak connections.
const cache = globalThis as typeof globalThis & { __pool?: Pool };

export const pool = cache.__pool ?? new Pool({ connectionString });

if (process.env.NODE_ENV !== "production") {
  cache.__pool = pool;
}
