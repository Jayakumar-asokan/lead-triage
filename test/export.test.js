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

test("a file with SaaSquatch's column names is read in full", () => {
  const csv = "Company,Website,Industry,Year Founded,City,State,Company LinkedIn,Business Phone\n" + "Lone Star Air,lonestarair.example,HVAC,1998,Austin,Texas,https://www.linkedin.com/company/lone-star-air,512-555-0142";
  const { leads, stats } = cleanCsv(csv);
  assert.equal(leads[0].company, "Lone Star Air");
  assert.equal(leads[0].industry, "HVAC");
  assert.equal(leads[0].location, "Austin, Texas");
  assert.equal(leads[0].phone, "512-555-0142");
  assert.equal(leads[0].linkedin, "https://www.linkedin.com/company/lone-star-air");
  assert.deepEqual(stats.unmappedHeaders, ["Year Founded"]);
});

test("the export starts with the columns SaaSquatch's import asks for", () => {
  const { leads } = cleanCsv("Company,Website,Industry,Location,Phone\nLone Star Air,lonestarair.example,HVAC,\"Austin, TX\",512-555-0142");
  const csv = leadsToCsv(rankLeads(leads));
  const { data, meta } = Papa.parse(csv, { header: true });
  assert.deepEqual(meta.fields.slice(0, 6), ["Company", "Industry", "City", "State", "Business Phone", "Website"]);
  assert.equal(data[0].City, "Austin");
  assert.equal(data[0].State, "TX");
  assert.equal(data[0]["Business Phone"], "512-555-0142");
});

test("the export can be uploaded again without losing leads", () => {
  const { leads } = cleanCsv("Company,Website\nAcme,acme.com\nOther,other.com");
  const again = cleanCsv(leadsToCsv(rankLeads(leads)));
  assert.deepEqual(again.leads.map((l) => l.domain).sort(), ["acme.com", "other.com"]);
});
