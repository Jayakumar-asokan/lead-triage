// Turns ranked leads back into a CSV that a CRM or SaaSquatch can import.
// The score, tier and reasons travel with each lead so the next person sees why it ranked.

import Papa from "papaparse";

export function leadsToCsv(leads) {
  const rows = leads.map((lead) => ({
    Score: lead.score,
    Tier: lead.tier,
    Action: lead.action,
    Company: lead.company,
    Website: lead.domain,
    Email: lead.email,
    "Email check": lead.checks?.email?.status ?? "",
    "Website check": lead.checks?.website?.status ?? "",
    Phone: lead.phone,
    Contact: lead.contact,
    Title: lead.title,
    Industry: lead.industry,
    Employees: lead.employees,
    Revenue: lead.revenue,
    Location: lead.location,
    "What they do": lead.checks?.website?.description || lead.checks?.website?.title || "",
    "Still unknown": (lead.unknowns ?? []).join("; "),
    "Why this score": (lead.reasons ?? []).map((r) => `${r.label} ${r.points}/${r.max}`).join("; "),
    LinkedIn: lead.linkedin ?? "",
    "AI note": lead.note?.why ?? "",
    "AI opening line": lead.note?.opener ?? "",
  }));
  return Papa.unparse(rows);
}
