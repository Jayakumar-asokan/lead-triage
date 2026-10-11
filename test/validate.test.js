import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWebsite, emailKind, extractPageInfo, isPrivateAddress, mapLimit, validateEmail, validateLeads } from "../lib/validate.js";

// Fake network: only acme.com exists, has mail, and serves a homepage.
function fakeDeps(overrides = {}) {
  const calls = { mx: 0, fetch: 0 };
  const deps = {
    calls,
    resolveMx: async (domain) => {
      calls.mx++;
      if (domain === "acme.com") return [{ exchange: "mx.acme.com", priority: 10 }];
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    },
    lookup: async (host) => {
      if (host === "acme.com" || host === "www.acme.com") return [{ address: "93.184.216.34", family: 4 }];
      if (host === "internal.acme.com") return [{ address: "10.0.0.5", family: 4 }];
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    },
    fetch: async (url) => {
      calls.fetch++;
      if (url === "https://acme.com/") return new Response(null, { status: 301, headers: { location: "https://www.acme.com/" } });
      return new Response("<html><head><title> Acme &amp; Co </title><meta name='description' content='Robots for warehouses'></head></html>", { status: 200 });
    },
    ...overrides,
  };
  return deps;
}

test("emailKind separates shared inboxes, webmail and named people", () => {
  assert.equal(emailKind("info@acme.com"), "role");
  assert.equal(emailKind("jane.doe@gmail.com"), "free");
  assert.equal(emailKind("jane.doe@acme.com"), "personal");
});

test("validateEmail reports missing and malformed addresses without any lookup", async () => {
  const deps = fakeDeps();
  assert.deepEqual(await validateEmail("", deps), { status: "missing" });
  assert.deepEqual(await validateEmail("office@contoso", deps), { status: "invalid_format" });
  assert.deepEqual(await validateEmail("sales@@acme.com", deps), { status: "invalid_format" });
  assert.equal(deps.calls.mx, 0);
});

test("validateEmail accepts a domain with a mail server and rejects one without", async () => {
  const deps = fakeDeps();
  assert.deepEqual(await validateEmail("bob@acme.com", deps), { status: "valid", kind: "personal" });
  assert.deepEqual(await validateEmail("bob@nowhere.invalid", deps), { status: "no_mail_server" });
});

test("validateEmail says unknown, not invalid, when DNS itself fails", async () => {
  const deps = fakeDeps({ resolveMx: async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" }); } });
  assert.deepEqual(await validateEmail("bob@acme.com", deps), { status: "unknown" });
});

test("isPrivateAddress flags internal ranges only", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("extractPageInfo reads the title and description", () => {
  const html = '<title>Acme &amp; Co</title><meta property="og:description" content="We  build\n robots">';
  assert.deepEqual(extractPageInfo(html), { title: "Acme & Co", description: "We build robots" });
  assert.deepEqual(extractPageInfo("<p>nothing</p>"), { title: "", description: "" });
});

test("checkWebsite follows a redirect and returns the page info", async () => {
  const result = await checkWebsite("acme.com", fakeDeps());
  assert.equal(result.status, "live");
  assert.equal(result.url, "https://www.acme.com/");
  assert.equal(result.title, "Acme & Co");
  assert.equal(result.description, "Robots for warehouses");
});

test("checkWebsite reports a dead domain", async () => {
  const result = await checkWebsite("nowhere.invalid", fakeDeps());
  assert.equal(result.status, "dead");
  assert.equal(result.reason, "ENOTFOUND");
});

test("checkWebsite treats a bot block as an existing site", async () => {
  const deps = fakeDeps({ fetch: async () => new Response("denied", { status: 403 }) });
  assert.deepEqual(await checkWebsite("acme.com", deps), { status: "restricted", httpStatus: 403 });
});

test("checkWebsite never fetches a private address, directly or through a redirect", async () => {
  const direct = fakeDeps();
  assert.deepEqual(await checkWebsite("internal.acme.com", direct), { status: "skipped_private" });
  assert.equal(direct.calls.fetch, 0);

  const viaRedirect = fakeDeps({ fetch: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }) });
  assert.deepEqual(await checkWebsite("acme.com", viaRedirect), { status: "skipped_private" });
});

test("mapLimit keeps order and never exceeds the limit", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    peak = Math.max(peak, ++running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.equal(peak, 2);
});

test("validateLeads attaches checks and looks each domain up once", async () => {
  const deps = fakeDeps();
  const leads = [
    { company: "Acme", email: "bob@acme.com", domain: "acme.com" },
    { company: "Acme West", email: "bob@acme.com", domain: "acme.com" },
    { company: "Phone Only", email: "", domain: "" },
  ];
  const result = await validateLeads(leads, { deps });
  assert.equal(result[0].checks.email.status, "valid");
  assert.equal(result[1].checks.website.status, "live");
  assert.deepEqual(result[2].checks, { email: { status: "missing" }, website: { status: "missing" } });
  assert.equal(deps.calls.mx, 1);
  assert.equal(deps.calls.fetch, 2); // one redirect + one page, shared by both Acme rows
});
