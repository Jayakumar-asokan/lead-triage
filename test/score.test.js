import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE, rankLeads, scoreLead } from "../lib/score.js";

// A lead that matches the default profile on every rule.
function idealLead(overrides = {}) {
  return {
    company: "Acme Software",
    industry: "Software",
    revenueUsd: 5_000_000,
    employeeCount: 30,
    email: "jane@acme.com",
    domain: "acme.com",
    phone: "555-0100",
    contact: "Jane Doe",
    title: "Founder & CEO",
    checks: { email: { status: "valid", kind: "personal" }, website: { status: "live", title: "Acme", description: "" } },
    ...overrides,
  };
}

const points = (result, label) => result.reasons.find((r) => r.label === label).points;

test("a lead that matches every rule scores 100 and is tier A", () => {
  const result = scoreLead(idealLead());
  assert.equal(result.score, 100);
  assert.equal(result.tier, "A");
  assert.deepEqual(result.unknowns, []);
});

test("the rule maximums add up to 100", () => {
  assert.equal(scoreLead(idealLead()).reasons.reduce((sum, r) => sum + r.max, 0), 100);
});

test("revenue: inside the range, just outside, far outside and unknown", () => {
  assert.equal(points(scoreLead(idealLead({ revenueUsd: 1_000_000 })), "Revenue"), 25);
  assert.equal(points(scoreLead(idealLead({ revenueUsd: 20_000_000 })), "Revenue"), 25);
  assert.equal(points(scoreLead(idealLead({ revenueUsd: 30_000_000 })), "Revenue"), 8);
  assert.equal(points(scoreLead(idealLead({ revenueUsd: 100_000_000 })), "Revenue"), 0);
  assert.equal(points(scoreLead(idealLead({ revenueUsd: null })), "Revenue"), 10);
});

test("unknown values are listed so the user knows what enrichment would settle", () => {
  const result = scoreLead(idealLead({ revenueUsd: null, employeeCount: null }));
  assert.deepEqual(result.unknowns, ["Revenue", "Company size"]);
});

test("industry can be matched from the website's own description", () => {
  const lead = idealLead({ industry: "", checks: { email: { status: "valid", kind: "role" }, website: { status: "live", title: "", description: "Privacy-first web analytics" } } });
  assert.equal(points(scoreLead(lead), "Industry"), 20);
});

test("an excluded keyword forces a skip even when everything else is perfect", () => {
  const profile = { ...DEFAULT_PROFILE, excludeKeywords: ["software"] };
  const result = scoreLead(idealLead(), profile);
  assert.equal(result.tier, "C");
  assert.match(result.action, /excluded/);
});

test("email points depend on what kind of address it is", () => {
  const withEmail = (email) => points(scoreLead(idealLead({ checks: { email, website: { status: "live" } } })), "Email");
  assert.equal(withEmail({ status: "valid", kind: "personal" }), 15);
  assert.equal(withEmail({ status: "valid", kind: "role" }), 11);
  assert.equal(withEmail({ status: "valid", kind: "free" }), 8);
  assert.equal(withEmail({ status: "unknown" }), 6);
  assert.equal(withEmail({ status: "no_mail_server" }), 0);
  assert.equal(withEmail({ status: "invalid_format" }), 0);
});

test("a lead with no working contact route is skipped whatever its fit", () => {
  const lead = idealLead({ phone: "", checks: { email: { status: "no_mail_server" }, website: { status: "dead" } } });
  const result = scoreLead(lead);
  assert.equal(result.tier, "C");
  assert.match(result.action, /no working way/);
});

test("a phone number alone keeps a lead reachable", () => {
  const lead = idealLead({ checks: { email: { status: "missing" }, website: { status: "missing" } } });
  const result = scoreLead(lead);
  assert.doesNotMatch(result.action, /no working way/);
  assert.match(result.action, /\(phone only\)$/);
});

test("only owner-level titles count as decision makers", () => {
  assert.equal(points(scoreLead(idealLead({ title: "Owner" })), "Contact"), 10);
  assert.equal(points(scoreLead(idealLead({ title: "Marketing Manager" })), "Contact"), 4);
  assert.equal(points(scoreLead(idealLead({ title: "", contact: "" })), "Contact"), 0);
});

test("scoring works before validation has run", () => {
  const lead = idealLead();
  delete lead.checks;
  const result = scoreLead(lead);
  assert.equal(points(result, "Email"), 6);
  assert.equal(points(result, "Website"), 4);
});

test("changing the profile changes the ranking", () => {
  const small = idealLead({ company: "Small Co", revenueUsd: 2_000_000 });
  const large = idealLead({ company: "Large Co", revenueUsd: 80_000_000, employeeCount: 400 });
  assert.equal(rankLeads([large, small])[0].company, "Small Co");
  const bigBuyer = { ...DEFAULT_PROFILE, revenueMin: 50_000_000, revenueMax: 200_000_000, employeesMin: 200, employeesMax: 1000 };
  assert.equal(rankLeads([large, small], bigBuyer)[0].company, "Large Co");
});
