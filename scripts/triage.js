// Runs the pipeline on a CSV from the command line:  node scripts/triage.js public/sample-leads.csv
import { readFileSync } from "node:fs";
import { cleanCsv } from "../lib/clean.js";
import { validateLeads } from "../lib/validate.js";
import { rankLeads } from "../lib/score.js";

const file = process.argv[2] ?? "public/sample-leads.csv";
const { leads, stats } = cleanCsv(readFileSync(file, "utf8"));
console.log(`Read ${stats.rowsRead} rows, merged ${stats.duplicatesMerged} duplicates, ${stats.uniqueLeads} unique leads.\n`);

const started = Date.now();
const ranked = rankLeads(await validateLeads(leads));
console.table(
  ranked.map((lead) => ({
    score: lead.score,
    tier: lead.tier,
    company: lead.company.slice(0, 26),
    email: lead.checks.email.status + (lead.checks.email.kind ? ` (${lead.checks.email.kind})` : ""),
    website: lead.checks.website.status,
    action: lead.action,
    unknown: lead.unknowns.join(", "),
  })),
);
const count = (tier) => ranked.filter((l) => l.tier === tier).length;
console.log(`A: ${count("A")}  B: ${count("B")}  C: ${count("C")}   (validated and scored in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
