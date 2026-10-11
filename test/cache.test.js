import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKeys, createMemoryStore, validateWithCache } from "../lib/cache.js";

function fakeDeps() {
  const calls = { mx: 0, fetch: 0 };
  return {
    calls,
    resolveMx: async () => {
      calls.mx++;
      return [{ exchange: "mx.acme.com", priority: 10 }];
    },
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetch: async () => {
      calls.fetch++;
      return new Response("<title>Acme</title>", { status: 200 });
    },
  };
}

const leads = [
  { company: "Acme", email: "jane@acme.com", domain: "acme.com" },
  { company: "Acme West", email: "bob@acme.com", domain: "acme.com" },
];

test("cache keys are domains only, never a person's address", () => {
  assert.deepEqual(cacheKeys(leads), ["site:acme.com", "mx:acme.com"]);
  assert.deepEqual(cacheKeys([{ company: "Phone only", email: "", domain: "" }]), []);
});

test("a second upload of the same domains makes no network calls", async () => {
  const store = createMemoryStore();
  const deps = fakeDeps();

  const first = await validateWithCache(leads, { store, deps });
  assert.deepEqual(first.cache, { store: "memory", reused: 0, lookedUp: 2 });
  assert.deepEqual(deps.calls, { mx: 1, fetch: 1 });

  const second = await validateWithCache(leads, { store, deps });
  assert.deepEqual(second.cache, { store: "memory", reused: 2, lookedUp: 0 });
  assert.deepEqual(deps.calls, { mx: 1, fetch: 1 });
  assert.deepEqual(second.leads, first.leads);
});

test("each address still gets its own kind from a cached domain result", async () => {
  const store = createMemoryStore();
  await validateWithCache(leads, { store, deps: fakeDeps() });
  const again = await validateWithCache([{ company: "Acme", email: "info@acme.com", domain: "acme.com" }], { store, deps: fakeDeps() });
  assert.deepEqual(again.leads[0].checks.email, { status: "valid", kind: "role" });
});

test("cached results expire after seven days", async () => {
  let clock = 0;
  const store = createMemoryStore(() => clock);
  const deps = fakeDeps();
  await validateWithCache(leads, { store, deps });
  clock = 8 * 24 * 60 * 60 * 1000;
  const later = await validateWithCache(leads, { store, deps });
  assert.equal(later.cache.reused, 0);
  assert.deepEqual(deps.calls, { mx: 2, fetch: 2 });
});

test("results that might succeed next time are not remembered", async () => {
  const store = createMemoryStore();
  const flaky = { ...fakeDeps(), resolveMx: async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" }); } };
  const first = await validateWithCache(leads, { store, deps: flaky });
  assert.equal(first.leads[0].checks.email.status, "unknown");
  const second = await validateWithCache(leads, { store, deps: fakeDeps() });
  assert.equal(second.leads[0].checks.email.status, "valid");
});

test("validation still works when the database is down", async () => {
  const broken = { kind: "postgres", read: async () => { throw new Error("connection refused"); }, write: async () => { throw new Error("connection refused"); } };
  const original = console.error;
  console.error = () => {};
  try {
    const result = await validateWithCache(leads, { store: broken, deps: fakeDeps() });
    assert.equal(result.leads[0].checks.website.status, "live");
    assert.equal(result.cache.reused, 0);
  } finally {
    console.error = original;
  }
});
