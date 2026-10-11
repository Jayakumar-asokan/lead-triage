import { test } from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import { cleanCsv } from "../lib/clean.js";
import { leadsToCsv } from "../lib/export.js";
import { rankLeads } from "../lib/score.js";

test("exported CSV carries the score, tier and reasons with each lead", () => {
  const { leads } = cleanCsv('Company,Website,Email,Revenue,Employees,Industry\n"Acme, Inc.",acme.com,bob@acme.com,$5M,30,Software');
  const checked = leads.map((l) => ({ ...l, checks: { email: { status: "valid", kind: "personal" }, website: { status: "live", description: 'Robots, "smart" ones' } } }));
  const rows = Papa.parse(leadsToCsv(rankLeads(checked)), { header: true }).data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Company, "Acme, Inc.");
  assert.equal(rows[0].Tier, "A");
  assert.equal(rows[0]["What they do"], 'Robots, "smart" ones');
  assert.match(rows[0]["Why this score"], /Revenue 25\/25/);
});

test("the export can be uploaded again without losing leads", () => {
  const { leads } = cleanCsv("Company,Website\nAcme,acme.com\nOther,other.com");
  const again = cleanCsv(leadsToCsv(rankLeads(leads)));
  assert.deepEqual(again.leads.map((l) => l.domain).sort(), ["acme.com", "other.com"]);
});
