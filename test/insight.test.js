import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, generateInsights, MAX_INSIGHT_LEADS, parseInsights, toCompanyFacts } from "../lib/insight.js";
import { DEFAULT_PROFILE } from "../lib/score.js";

const lead = {
  id: 3,
  company: "Acme Robotics",
  domain: "acme.com",
  email: "jane.doe@acme.com",
  phone: "555-0100",
  contact: "Jane Doe",
  title: "Founder",
  linkedin: "https://www.linkedin.com/company/acme",
  industry: "Robotics",
  revenue: "$5M",
  employees: "30",
  location: "Austin, TX",
  score: 88,
  unknowns: [],
  checks: { email: { status: "valid", kind: "personal" }, website: { status: "live", description: "Robots for small warehouses" } },
};

const geminiReply = (items) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }] }), { status: 200 });

test("no contact name, email or phone is sent to the AI service", () => {
  const sent = JSON.stringify(buildRequest([lead], DEFAULT_PROFILE));
  for (const secret of ["Jane", "jane.doe@acme.com", "555-0100", "Founder", "linkedin.com"]) assert.equal(sent.includes(secret), false, secret);
  assert.ok(sent.includes("Acme Robotics"));
  assert.ok(sent.includes("Robots for small warehouses"));
});

test("long website text is cut down before it is sent", () => {
  const facts = toCompanyFacts({ ...lead, checks: { website: { description: "x".repeat(5000) } } });
  assert.equal(facts.whatTheySay.length, 300);
});

test("parseInsights keeps only well-formed notes for the ids that were asked about", () => {
  const text = JSON.stringify([
    { id: 3, why: "Fits the size range.", opener: "I saw you build warehouse robots." },
    { id: 99, why: "Not requested.", opener: "x" },
    { id: 3, why: "Duplicate.", opener: "x" },
    { id: 4, why: 42, opener: "wrong type" },
    "not an object",
  ]);
  assert.deepEqual(parseInsights(text, [3, 4]), [{ id: 3, why: "Fits the size range.", opener: "I saw you build warehouse robots." }]);
});

test("parseInsights survives a reply that is not JSON or not a list, and caps the length", () => {
  assert.deepEqual(parseInsights("Sorry, I cannot help with that.", [3]), []);
  assert.deepEqual(parseInsights('{"id":3}', [3]), []);
  const [note] = parseInsights(JSON.stringify([{ id: 3, why: "y".repeat(2000), opener: "ok" }]), [3]);
  assert.equal(note.why.length, 320);
});

test("generateInsights sends the key in a header and returns parsed notes", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return geminiReply([{ id: 3, why: "Fits.", opener: "Hello." }]);
  };
  const notes = await generateInsights([lead], DEFAULT_PROFILE, { fetchImpl, apiKey: "test-key" });
  assert.deepEqual(notes, [{ id: 3, why: "Fits.", opener: "Hello." }]);
  assert.equal(seen.init.headers["x-goog-api-key"], "test-key");
  assert.equal(seen.url.includes("test-key"), false);
});

test("generateInsights falls back to the lighter model when the main one is overloaded", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return urls.length === 1 ? new Response("{}", { status: 503 }) : geminiReply([{ id: 3, why: "Fits.", opener: "Hello." }]);
  };
  const original = console.error;
  console.error = () => {};
  try {
    const notes = await generateInsights([lead], DEFAULT_PROFILE, { fetchImpl, apiKey: "test-key" });
    assert.equal(notes.length, 1);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /flash-lite/);
  } finally {
    console.error = original;
  }
});

test("generateInsights also falls back when the main model does not answer in time", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    if (++calls === 1) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    return geminiReply([{ id: 3, why: "Fits.", opener: "Hello." }]);
  };
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await generateInsights([lead], DEFAULT_PROFILE, { fetchImpl, apiKey: "test-key" })).length, 1);
    const neverAnswers = async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); };
    await assert.rejects(generateInsights([lead], DEFAULT_PROFILE, { fetchImpl: neverAnswers, apiKey: "test-key" }), { status: 429, message: /busy/ });
  } finally {
    console.error = original;
  }
});

test("generateInsights never sends more than the batch limit", async () => {
  let count;
  const fetchImpl = async (_url, init) => {
    count = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text).companies.length;
    return geminiReply([]);
  };
  const many = Array.from({ length: MAX_INSIGHT_LEADS + 15 }, (_, id) => ({ ...lead, id }));
  await generateInsights(many, DEFAULT_PROFILE, { fetchImpl, apiKey: "test-key" });
  assert.equal(count, MAX_INSIGHT_LEADS);
});

test("generateInsights reports a missing key, a rejected key and a used-up quota clearly", async () => {
  await assert.rejects(generateInsights([lead], DEFAULT_PROFILE, { apiKey: "" }), { status: 503 });
  const original = console.error;
  console.error = () => {};
  try {
    const busy = async () => new Response("{}", { status: 429 });
    await assert.rejects(generateInsights([lead], DEFAULT_PROFILE, { fetchImpl: busy, apiKey: "test-key" }), { status: 429, message: /quota/ });
    const rejected = async () => new Response(JSON.stringify({ error: { message: "API key not valid." } }), { status: 400 });
    await assert.rejects(generateInsights([lead], DEFAULT_PROFILE, { fetchImpl: rejected, apiKey: "bad-key" }), { status: 502, message: /key on this server was rejected/ });
  } finally {
    console.error = original;
  }
});
