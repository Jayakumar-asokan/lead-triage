// Step 2 of the pipeline: check that each lead can actually be reached.
// Email: is the address well formed, and does its domain accept mail (MX record)?
// Website: does the company's site respond, and what does it say about itself?
// The network calls are passed in as `deps` so the tests can replace them with fakes.

import { lookup as dnsLookup, resolveMx as systemResolveMx, Resolver } from "node:dns/promises";
import { isIP } from "node:net";

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const ROLE_MAILBOXES = new Set(["info", "hello", "support", "help", "sales", "contact", "office", "admin", "team", "jobs", "careers", "billing", "enquiries", "inquiries"]);
const FREE_MAIL_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "proton.me", "protonmail.com"]);

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 200_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "LeadTriageBot/0.1 (lead validation; reads the homepage only)";

const NO_SUCH_DOMAIN = new Set(["ENOTFOUND", "ENODATA"]);

// Some machines (a laptop behind a VPN, a locked-down container) have no usable DNS
// server for MX queries. When the system resolver cannot be reached, ask public ones.
const publicResolver = new Resolver({ timeout: 3000, tries: 2 });
publicResolver.setServers(["1.1.1.1", "8.8.8.8"]);

async function dnsResolveMx(domain) {
  try {
    return await systemResolveMx(domain);
  } catch (err) {
    if (NO_SUCH_DOMAIN.has(err.code)) throw err;
    return publicResolver.resolveMx(domain);
  }
}

const defaultDeps = { resolveMx: dnsResolveMx, lookup: dnsLookup, fetch: (...args) => fetch(...args) };

// role = shared inbox (info@), free = personal webmail (gmail), personal = a named person at the company.
export function emailKind(email) {
  const [mailbox, domain] = email.toLowerCase().split("@");
  if (FREE_MAIL_DOMAINS.has(domain)) return "free";
  if (ROLE_MAILBOXES.has(mailbox)) return "role";
  return "personal";
}

// Does this domain accept mail? The answer is the same for every address at the domain,
// so it is looked up (and cached) per domain, never per person.
export async function checkMailDomain(domain, deps = defaultDeps) {
  try {
    const records = await deps.resolveMx(domain);
    return { status: records.length ? "valid" : "no_mail_server" };
  } catch (err) {
    // ENOTFOUND / ENODATA mean the domain has no mail server. Anything else is a DNS hiccup.
    return { status: NO_SUCH_DOMAIN.has(err.code) ? "no_mail_server" : "unknown" };
  }
}

export async function validateEmail(email, deps = defaultDeps, lookupDomain = (domain) => checkMailDomain(domain, deps)) {
  if (!email) return { status: "missing" };
  if (!EMAIL_PATTERN.test(email)) return { status: "invalid_format" };
  const { status } = await lookupDomain(email.split("@")[1].toLowerCase());
  return status === "valid" ? { status, kind: emailKind(email) } : { status };
}

// The server fetches addresses that came from an uploaded file, so it must never be
// tricked into calling machines on its own network (localhost, 10.x, 192.168.x, ...).
export function isPrivateAddress(address) {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    return a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80") || a.startsWith("::ffff:");
  }
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function isSafeHost(hostname, deps) {
  if (isIP(hostname)) return !isPrivateAddress(hostname);
  const addresses = await deps.lookup(hostname, { all: true });
  return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
}

function decodeEntities(text) {
  return text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

// Pulls the page title and meta description: the company's own one-line pitch.
export function extractPageInfo(html) {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "";
  const metaTag = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i)?.[0] ?? "";
  const description = metaTag.match(/content=["']([^"']*)["']/i)?.[1] ?? "";
  const tidy = (text) => decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, 300);
  return { title: tidy(title), description: tidy(description) };
}

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (size < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// live = page loaded; restricted = the site exists but refuses bots; dead = nothing answers.
export async function checkWebsite(domain, deps = defaultDeps) {
  if (!domain) return { status: "missing" };
  let url = `https://${domain}/`;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isSafeHost(new URL(url).hostname, deps))) return { status: "skipped_private" };
      const response = await deps.fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url).href;
        continue;
      }
      if ([401, 403, 429, 503].includes(response.status)) return { status: "restricted", httpStatus: response.status };
      if (!response.ok) return { status: "dead", httpStatus: response.status };
      return { status: "live", httpStatus: response.status, url, ...extractPageInfo(await readLimited(response)) };
    }
    return { status: "dead", reason: "too many redirects" };
  } catch (err) {
    return { status: "dead", reason: err.cause?.code ?? err.code ?? err.name };
  }
}

// Runs `worker` over `items`, at most `limit` at a time, keeping the original order.
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// Cache keys. Only domains are ever used as keys: no names or email addresses.
export const mailKey = (domain) => `mx:${domain}`;
export const webKey = (domain) => `web:${domain}`;

// `cache` remembers results per domain, so two leads at one company cost one lookup.
export async function validateLeads(leads, { deps = defaultDeps, cache = new Map(), concurrency = 8 } = {}) {
  const once = (key, task) => {
    if (!cache.has(key)) cache.set(key, task());
    return cache.get(key);
  };
  return mapLimit(leads, concurrency, async (lead) => {
    const [email, website] = await Promise.all([
      validateEmail(lead.email, deps, (domain) => once(mailKey(domain), () => checkMailDomain(domain, deps))),
      lead.domain ? once(webKey(lead.domain), () => checkWebsite(lead.domain, deps)) : checkWebsite("", deps),
    ]);
    return { ...lead, checks: { email, website } };
  });
}
