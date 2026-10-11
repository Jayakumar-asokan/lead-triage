import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWebsite, emailKind, extractContacts, extractPageInfo, isPrivateAddress, mapLimit, validateEmail, validateLeads } from "../lib/validate.js";

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

test("extractContacts finds a tel: phone, the LinkedIn company page and the contact page", () => {
  const html = `
    <a href="/about">About</a> <a class="nav" href="/contact-us/">Contact</a> <a href="https://other.com/contact">Partner</a>
    <a href="tel:+1%20555%20010%200199">Call us</a>
    <a href="https://www.linkedin.com/company/acme-robotics">LinkedIn</a>`;
  assert.deepEqual(extractContacts(html, "https://acme.com/"), {
    phone: "+1 555 010 0199",
    linkedin: "https://www.linkedin.com/company/acme-robotics",
    contactUrl: "https://acme.com/contact-us/",
  });
});

test("extractContacts ignores short numbers, personal LinkedIn profiles and other sites", () => {
  const html = '<a href="tel:911">x</a> <a href="https://linkedin.com/in/jane-doe">Jane</a> <a href="https://evil.example/contact">c</a>';
  assert.deepEqual(extractContacts(html, "https://acme.com/"), { phone: "", linkedin: "", contactUrl: "" });
});

test("checkWebsite reads the contact page when the homepage has no phone", async () => {
  const pages = {
    "https://acme.com/": '<title>Acme</title><a href="/contact">Contact</a>',
    "https://acme.com/contact": '<a href="tel:555-010-0142">Call</a>',
  };
  const deps = fakeDeps({ fetch: async (url) => { deps.calls.fetch++; return new Response(pages[url] ?? "", { status: pages[url] ? 200 : 404 }); } });
  const result = await checkWebsite("acme.com", deps);
  assert.equal(result.status, "live");
  assert.equal(result.phone, "555-010-0142");
  assert.equal(deps.calls.fetch, 2);
});

test("a broken contact page does not turn a live site into a dead one", async () => {
  const deps = fakeDeps({
    fetch: async (url) => {
      if (url.endsWith("/contact")) throw new Error("socket hang up");
      return new Response('<title>Acme</title><a href="/contact">Contact</a>', { status: 200 });
    },
  });
  const result = await checkWebsite("acme.com", deps);
  assert.equal(result.status, "live");
  assert.equal(result.phone, undefined);
});

test("validateLeads fills a missing phone from the website but never overwrites the upload", async () => {
  const deps = fakeDeps({ fetch: async () => new Response('<a href="tel:555-010-0142">Call</a>', { status: 200 }) });
  const [blank, given] = await validateLeads(
    [
      { company: "Acme", email: "", phone: "", linkedin: "", domain: "acme.com" },
      { company: "Acme HQ", email: "", phone: "555-9999", linkedin: "", domain: "acme.com" },
    ],
    { deps },
  );
  assert.equal(blank.phone, "555-010-0142");
  assert.deepEqual(blank.foundOnSite, ["phone"]);
  assert.equal(given.phone, "555-9999");
  assert.deepEqual(given.foundOnSite, []);
});

test("leads not started before the deadline come back unchecked, not lost", async () => {
  const deps = fakeDeps();
  let clock = 0;
  const leads = [1, 2, 3].map((n) => ({ company: `Co ${n}`, email: `bad-address-${n}`, phone: "", linkedin: "", domain: "acme.com" }));
  const result = await validateLeads(leads, { deps, concurrency: 1, deadline: 5, now: () => (clock += 4) });
  assert.equal(result.length, 3);
  assert.equal(result[0].checks.website.status, "live");
  assert.equal(result[0].unchecked, undefined);
  assert.deepEqual(result[2].checks, { email: { status: "invalid_format" }, website: { status: "unknown" } });
  assert.equal(result[2].unchecked, true);
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
