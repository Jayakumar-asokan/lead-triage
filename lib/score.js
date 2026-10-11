// Step 3 of the pipeline: rank leads against the buyer's target profile.
// The score is a plain sum of visible rules (no black box), so a user can see
// exactly why a lead ranked where it did and change the profile if they disagree.
//
//   Fit          60 pts  revenue 25 + company size 15 + industry 20
//   Reachability 30 pts  email 15 + website 10 + phone 5
//   Contact      10 pts  is the named person a decision maker?

export const DEFAULT_PROFILE = {
  revenueMin: 1_000_000,
  revenueMax: 20_000_000,
  employeesMin: 5,
  employeesMax: 100,
  includeKeywords: ["software", "saas", "analytics", "services"],
  excludeKeywords: [],
};

const DECISION_MAKER = /\b(owner|founder|co-?founder|ceo|president|principal|managing director|proprietor)\b/i;
const EMAIL_POINTS = { personal: 15, role: 11, free: 8 };

export function formatMoney(n) {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${n}`;
}

// Full points inside the range, a few when close (within 2x), none when far off.
// An unknown value gets a small neutral score: we cannot rule the lead out yet.
function rangeRule(label, value, min, max, maxPoints, format) {
  const range = Number.isFinite(max) ? `${format(min)}–${format(max)}` : `${format(min)} or more`;
  if (value === null || value === undefined) {
    return { label, points: Math.round(maxPoints * 0.4), max: maxPoints, tone: "unknown", note: `Not known (target ${range})` };
  }
  if (value >= min && value <= max) return { label, points: maxPoints, max: maxPoints, tone: "good", note: `${format(value)} is inside ${range}` };
  if (value >= min / 2 && value <= max * 2) return { label, points: Math.round(maxPoints * 0.3), max: maxPoints, tone: "warn", note: `${format(value)} is just outside ${range}` };
  return { label, points: 0, max: maxPoints, tone: "bad", note: `${format(value)} is far outside ${range}` };
}

function findKeyword(text, keywords) {
  return keywords.find((k) => k.trim() && text.includes(k.trim().toLowerCase())) ?? null;
}

function industryRule(lead, profile) {
  const max = 20;
  const site = lead.checks?.website ?? {};
  const text = [lead.industry, site.title, site.description].filter(Boolean).join(" ").toLowerCase();
  const excluded = findKeyword(text, profile.excludeKeywords);
  if (excluded) return { label: "Industry", points: 0, max, tone: "bad", note: `Matches excluded keyword "${excluded}"`, excluded: true };
  if (!profile.includeKeywords.length) return { label: "Industry", points: max / 2, max, tone: "unknown", note: "No target keywords set" };
  if (!text) return { label: "Industry", points: 6, max, tone: "unknown", note: "Industry not known" };
  const hit = findKeyword(text, profile.includeKeywords);
  if (hit) return { label: "Industry", points: max, max, tone: "good", note: `Matches "${hit}"` };
  return { label: "Industry", points: 4, max, tone: "warn", note: "No target keyword found" };
}

function emailRule(lead) {
  const max = 15;
  const check = lead.checks?.email ?? { status: lead.email ? "unknown" : "missing" };
  if (check.status === "valid") {
    const notes = { personal: "Named person's address, mail server found", role: "Shared inbox, mail server found", free: "Personal webmail address" };
    return { label: "Email", points: EMAIL_POINTS[check.kind] ?? 8, max, tone: check.kind === "personal" ? "good" : "warn", note: notes[check.kind] ?? "Mail server found" };
  }
  if (check.status === "unknown") return { label: "Email", points: 6, max, tone: "unknown", note: "Could not be verified" };
  const notes = { missing: "No email address", invalid_format: "Address is malformed", no_mail_server: "Domain has no mail server" };
  return { label: "Email", points: 0, max, tone: "bad", note: notes[check.status] ?? "Not usable" };
}

function websiteRule(lead) {
  const max = 10;
  const status = lead.checks?.website?.status ?? (lead.domain ? "unknown" : "missing");
  const table = {
    live: [10, "good", "Website is live"],
    restricted: [7, "warn", "Website exists but blocks automated visits"],
    unknown: [4, "unknown", "Website not checked"],
    skipped_private: [0, "bad", "Website points to a private address"],
    dead: [0, "bad", "Website does not respond"],
    missing: [0, "bad", "No website"],
  };
  const [points, tone, note] = table[status] ?? table.unknown;
  return { label: "Website", points, max, tone, note };
}

function phoneRule(lead) {
  return lead.phone ? { label: "Phone", points: 5, max: 5, tone: "good", note: "Phone number present" } : { label: "Phone", points: 0, max: 5, tone: "bad", note: "No phone number" };
}

function contactRule(lead) {
  const max = 10;
  if (DECISION_MAKER.test(lead.title ?? "")) return { label: "Contact", points: max, max, tone: "good", note: `Decision maker (${lead.title})` };
  if (lead.contact || lead.title) return { label: "Contact", points: 4, max, tone: "warn", note: "Named contact, not a clear decision maker" };
  return { label: "Contact", points: 0, max, tone: "bad", note: "No named contact" };
}

export function scoreLead(lead, profile = DEFAULT_PROFILE) {
  const reasons = [
    rangeRule("Revenue", lead.revenueUsd, profile.revenueMin, profile.revenueMax, 25, formatMoney),
    rangeRule("Company size", lead.employeeCount, profile.employeesMin, profile.employeesMax, 15, (n) => `${n}`),
    industryRule(lead, profile),
    emailRule(lead),
    websiteRule(lead),
    phoneRule(lead),
    contactRule(lead),
  ];
  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  const reachable = reasons.slice(3, 6).some((r) => r.points > 0);
  const excluded = reasons.some((r) => r.excluded);

  // The tier is the action for the user: where to spend enrichment credits and call time.
  let tier = score >= 70 ? "A" : score >= 45 ? "B" : "C";
  let action = { A: "Enrich and contact first", B: "Review before spending a credit", C: "Skip" }[tier];
  if (excluded) [tier, action] = ["C", "Skip: excluded industry"];
  else if (!reachable) [tier, action] = ["C", "Skip: no working way to reach them"];
  else if (tier !== "C" && reasons[3].points === 0 && reasons[4].points === 0) action += " (phone only)";

  const unknowns = reasons.filter((r) => r.tone === "unknown").map((r) => r.label);
  return { score, tier, action, reasons, unknowns };
}

export function rankLeads(leads, profile = DEFAULT_PROFILE) {
  return leads
    .map((lead) => ({ ...lead, ...scoreLead(lead, profile) }))
    .sort((a, b) => b.score - a.score || a.company.localeCompare(b.company));
}
