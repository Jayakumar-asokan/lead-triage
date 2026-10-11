import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanCsv, companyKey, dedupeLeads, normalizeDomain, normalizeLead, parseNumber } from "../lib/clean.js";

test("normalizeDomain strips protocol, www, path and port", () => {
  assert.equal(normalizeDomain("https://www.Acme.com/about?x=1"), "acme.com");
  assert.equal(normalizeDomain("ACME.com:8080"), "acme.com");
  assert.equal(normalizeDomain("jane@mail.acme.co.uk"), "mail.acme.co.uk");
});

test("normalizeDomain rejects values that are not domains", () => {
  assert.equal(normalizeDomain("n/a"), "");
  assert.equal(normalizeDomain("acme"), "");
  assert.equal(normalizeDomain(""), "");
});

test("companyKey ignores case, punctuation and legal suffixes", () => {
  assert.equal(companyKey("Acme Robotics, Inc."), "acme robotics");
  assert.equal(companyKey("ACME ROBOTICS LLC"), "acme robotics");
  assert.equal(companyKey("Smith & Sons Pvt. Ltd."), "smith and sons");
});

test("parseNumber handles commas, units and ranges", () => {
  assert.equal(parseNumber("1,200"), 1200);
  assert.equal(parseNumber("$4.5M"), 4500000);
  assert.equal(parseNumber("51-200"), 126);
  assert.equal(parseNumber("unknown"), null);
});

test("normalizeLead maps differently named headers", () => {
  const lead = normalizeLead({ "Company Name": " Acme ", URL: "www.acme.com", "Work Email": "Bob@Acme.com", Headcount: "51-200" });
  assert.equal(lead.company, "Acme");
  assert.equal(lead.domain, "acme.com");
  assert.equal(lead.email, "bob@acme.com");
  assert.equal(lead.employeeCount, 126);
});

test("normalizeLead falls back to the email domain when there is no website", () => {
  assert.equal(normalizeLead({ company: "Acme", email: "bob@acme.io" }).domain, "acme.io");
});

test("dedupeLeads merges rows that share a domain and keeps the fullest data", () => {
  const rows = [
    normalizeLead({ company: "Acme Inc", website: "acme.com" }),
    normalizeLead({ company: "ACME", website: "https://www.acme.com/", email: "bob@acme.com", industry: "Robotics" }),
    normalizeLead({ company: "Other Co", website: "other.com", phone: "555-0100" }),
  ];
  const { leads, removed } = dedupeLeads(rows);
  assert.equal(removed, 1);
  assert.equal(leads.length, 2);
  const acme = leads.find((l) => l.domain === "acme.com");
  assert.equal(acme.email, "bob@acme.com");
  assert.equal(acme.industry, "Robotics");
  assert.equal(acme.duplicates, 1);
});

test("dedupeLeads matches on company name when there is no domain", () => {
  const rows = [normalizeLead({ company: "Smith & Sons Ltd" }), normalizeLead({ company: "smith and sons", phone: "555-0101" })];
  const { leads } = dedupeLeads(rows);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].phone, "555-0101");
});

test("dedupeLeads joins a domainless row to the same company's domain", () => {
  const rows = [normalizeLead({ company: "Fabrikam Plumbing & Heating Ltd", phone: "555-0188" }), normalizeLead({ company: "Fabrikam Plumbing and Heating", email: "owner@fabrikam.com" })];
  const { leads } = dedupeLeads(rows);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].phone, "555-0188");
  assert.equal(leads[0].domain, "fabrikam.com");
});

test("dedupeLeads does not guess when a name maps to two domains", () => {
  const rows = [normalizeLead({ company: "Acme", website: "acme.com" }), normalizeLead({ company: "Acme", website: "acme.io" }), normalizeLead({ company: "Acme", phone: "555-0100" })];
  assert.equal(dedupeLeads(rows).leads.length, 3);
});

test("dedupeLeads keeps different companies apart", () => {
  const rows = [normalizeLead({ company: "Acme", website: "acme.com" }), normalizeLead({ company: "Acme", website: "acme.io" })];
  assert.equal(dedupeLeads(rows).leads.length, 2);
});

test("cleanCsv reports what it read and merged for the sample dataset", () => {
  const csv = readFileSync(new URL("../public/sample-leads.csv", import.meta.url), "utf8");
  const { leads, stats } = cleanCsv(csv);
  assert.equal(stats.rowsRead, 30);
  assert.equal(stats.uniqueLeads, leads.length);
  assert.equal(stats.rowsRead - stats.duplicatesMerged, stats.uniqueLeads);
  assert.ok(stats.duplicatesMerged >= 4);
  assert.deepEqual(stats.unmappedHeaders, ["Notes"]);
});
