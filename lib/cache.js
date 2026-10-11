// Remembers domain checks between uploads so the same website is not visited twice.
// Storage: one Postgres table (Neon) keyed by domain. Without DATABASE_URL (local
// development) it falls back to memory, so the app still runs with no setup.
//
// What is stored: public facts about a domain (is the site live, its title, does it
// accept mail). What is never stored: the uploaded lead list, names or email addresses.

import { neon } from "@neondatabase/serverless";
import { mailKey, validateLeads, webKey } from "./validate.js";

const TTL_DAYS = 7;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

export function createMemoryStore(now = () => Date.now()) {
  const rows = new Map();
  return {
    kind: "memory",
    async read(keys) {
      const found = new Map();
      for (const key of keys) {
        const row = rows.get(key);
        if (row && now() - row.at < TTL_MS) found.set(key, row.result);
      }
      return found;
    },
    async write(entries) {
      for (const { key, result } of entries) rows.set(key, { result, at: now() });
    },
  };
}

export function createPostgresStore(connectionString) {
  const sql = neon(connectionString);
  let ready;
  const ensureTable = () =>
    (ready ??= sql`CREATE TABLE IF NOT EXISTS check_cache (
      key text PRIMARY KEY,
      result jsonb NOT NULL,
      checked_at timestamptz NOT NULL DEFAULT now()
    )`);
  return {
    kind: "postgres",
    async read(keys) {
      if (!keys.length) return new Map();
      await ensureTable();
      const rows = await sql`
        SELECT key, result FROM check_cache
        WHERE key = ANY(${keys}) AND checked_at > now() - make_interval(days => ${TTL_DAYS})`;
      return new Map(rows.map((row) => [row.key, row.result]));
    },
    // One statement for the whole upload, however many domains it has.
    async write(entries) {
      if (!entries.length) return;
      await ensureTable();
      await sql`
        INSERT INTO check_cache (key, result)
        SELECT key, result FROM jsonb_to_recordset(${JSON.stringify(entries)}::jsonb) AS t(key text, result jsonb)
        ON CONFLICT (key) DO UPDATE SET result = EXCLUDED.result, checked_at = now()`;
    },
  };
}

let defaultStore;
export function getStore() {
  defaultStore ??= process.env.DATABASE_URL ? createPostgresStore(process.env.DATABASE_URL) : createMemoryStore();
  return defaultStore;
}

export function cacheKeys(leads) {
  const keys = new Set();
  for (const lead of leads) {
    if (lead.domain) keys.add(webKey(lead.domain));
    if (lead.email.includes("@")) keys.add(mailKey(lead.email.split("@")[1]));
  }
  return [...keys];
}

// A failed DNS lookup or a timeout may work next time, so those are not remembered.
function isCacheable(result) {
  return result.status !== "unknown" && !(result.status === "dead" && /timeout|abort/i.test(result.reason ?? ""));
}

// The cache is an optimisation: if the database is down, validation still runs.
export async function validateWithCache(leads, { store = getStore(), deps } = {}) {
  let cached = new Map();
  try {
    cached = await store.read(cacheKeys(leads));
  } catch (err) {
    console.error("cache read failed:", err.message);
  }
  const cache = new Map([...cached].map(([key, result]) => [key, Promise.resolve(result)]));
  const checked = await validateLeads(leads, { cache, deps });

  const fresh = [];
  for (const [key, pending] of cache) {
    if (cached.has(key)) continue;
    const result = await pending;
    if (isCacheable(result)) fresh.push({ key, result });
  }
  try {
    await store.write(fresh);
  } catch (err) {
    console.error("cache write failed:", err.message);
  }
  return { leads: checked, cache: { store: store.kind, reused: cached.size, lookedUp: cache.size - cached.size } };
}
