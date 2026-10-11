// Step 1 of the pipeline: turn a messy lead export into clean, de-duplicated records.
// Everything here is a pure function (no network, no database) so it is easy to test.

import Papa from "papaparse";

// Lead exports name their columns differently. Each of our fields lists the headers we accept.
const HEADER_ALIASES = {
  company: ["company", "company name", "organization", "organisation", "account", "business name"],
  website: ["website", "url", "domain", "company website", "web"],
  email: ["email", "email address", "contact email", "work email"],
  phone: ["phone", "phone number", "telephone", "mobile"],
  contact: ["contact", "contact name", "name", "full name", "owner"],
  title: ["title", "job title", "position", "role"],
  industry: ["industry", "sector", "vertical"],
  employees: ["employees", "employee count", "company size", "headcount", "size"],
  revenue: ["revenue", "annual revenue", "estimated revenue", "revenue estimate"],
  location: ["location", "city", "hq", "headquarters", "address"],
  linkedin: ["linkedin", "linkedin url", "company linkedin"],
};

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|llp|ltd|limited|pvt|private|corp|corporation|co|company|gmbh|plc|sa|bv)\b/g;

const FIELDS = Object.keys(HEADER_ALIASES);

function headerToField(header) {
  const h = header.trim().toLowerCase().replace(/[_-]+/g, " ");
  return FIELDS.find((field) => HEADER_ALIASES[field].includes(h)) ?? null;
}

// "https://www.Acme.com/about?x=1" -> "acme.com". Also accepts an email address.
export function normalizeDomain(value) {
  if (!value) return "";
  let v = String(value).trim().toLowerCase();
  if (v.includes("@")) v = v.split("@").pop();
  v = v.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  v = v.split(/[/?#]/)[0].replace(/:\d+$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : "";
}

// "Acme Robotics, Inc." -> "acme robotics". Used only for matching, never shown to the user.
export function companyKey(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "1,200", "51-200", "$4.5M", "250k" -> a number we can compare. Ranges use the midpoint.
export function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parts = String(value).toLowerCase().replace(/[$,\s]/g, "").match(/\d+(\.\d+)?[kmb]?/g);
  if (!parts) return null;
  const nums = parts.slice(0, 2).map((p) => {
    const unit = { k: 1e3, m: 1e6, b: 1e9 }[p.slice(-1)] ?? 1;
    return parseFloat(p) * unit;
  });
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function normalizeLead(row) {
  const lead = Object.fromEntries(FIELDS.map((f) => [f, ""]));
  for (const [header, raw] of Object.entries(row)) {
    const field = headerToField(header);
    const value = raw === null || raw === undefined ? "" : String(raw).trim();
    if (field && value && !lead[field]) lead[field] = value;
  }
  lead.email = lead.email.toLowerCase();
  // Prefer the website for the domain; fall back to the email's domain.
  lead.domain = normalizeDomain(lead.website) || normalizeDomain(lead.email);
  lead.employeeCount = parseNumber(lead.employees);
  lead.revenueUsd = parseNumber(lead.revenue);
  return lead;
}

export function parseCsv(text) {
  const { data, meta } = Papa.parse(text, { header: true, skipEmptyLines: "greedy" });
  const unmapped = (meta.fields ?? []).filter((h) => !headerToField(h));
  const leads = data.map(normalizeLead).filter((l) => l.company || l.domain || l.email);
  return { leads, unmappedHeaders: unmapped, rowCount: data.length };
}

// Two rows are the same lead when they share a domain, or (with no domain) a company name.
// A row without a domain also joins the one domain that its company name is known by.
function dedupeKey(lead, domainsByName) {
  if (lead.domain) return `d:${lead.domain}`;
  const key = companyKey(lead.company);
  const known = domainsByName.get(key);
  if (key && known?.size === 1) return `d:${[...known][0]}`;
  return key ? `c:${key}` : `e:${lead.email}`;
}

function filledCount(lead) {
  return FIELDS.filter((f) => lead[f]).length;
}

// Keeps the most complete row of each group and fills its blanks from the other rows.
export function dedupeLeads(leads) {
  const domainsByName = new Map();
  for (const lead of leads) {
    const key = companyKey(lead.company);
    if (!key || !lead.domain) continue;
    if (!domainsByName.has(key)) domainsByName.set(key, new Set());
    domainsByName.get(key).add(lead.domain);
  }
  const groups = new Map();
  for (const lead of leads) {
    const key = dedupeKey(lead, domainsByName);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }
  const unique = [];
  for (const group of groups.values()) {
    const [best, ...rest] = [...group].sort((a, b) => filledCount(b) - filledCount(a));
    const merged = { ...best, duplicates: rest.length };
    for (const other of rest) {
      for (const [field, value] of Object.entries(other)) {
        if ((merged[field] === "" || merged[field] === null) && value) merged[field] = value;
      }
    }
    unique.push(merged);
  }
  return { leads: unique, removed: leads.length - unique.length };
}

export function cleanCsv(text) {
  const parsed = parseCsv(text);
  const { leads, removed } = dedupeLeads(parsed.leads);
  return {
    leads,
    stats: {
      rowsRead: parsed.rowCount,
      duplicatesMerged: removed,
      uniqueLeads: leads.length,
      unmappedHeaders: parsed.unmappedHeaders,
    },
  };
}
