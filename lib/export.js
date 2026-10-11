// Turns ranked leads back into a CSV. The first six columns use the exact names that
// SaaSquatch's "Import Leads" dialog asks for (Company and Industry required; City, State,
// Business Phone and Website recommended), so the file can go straight back in for
// enrichment. The score, tier and reasons follow, so the next person sees why it ranked.

import Papa from "papaparse";

// "Austin, TX" -> ["Austin", "TX"]. Used when the upload had one Location column.
function cityAndState(lead) {
  if (lead.city || lead.state) return [lead.city ?? "", lead.state ?? ""];
  const [city = "", ...rest] = (lead.location ?? "").split(",").map((part) => part.trim());
  return [city, rest.join(", ")];
}

export function leadsToCsv(leads) {
  const rows = leads.map((lead) => {
    const [city, state] = cityAndState(lead);
    return {
      Company: lead.company,
      Industry: lead.industry,
      City: city,
      State: state,
      "Business Phone": lead.phone,
      Website: lead.domain,
      Score: lead.score,
      Tier: lead.tier,
      Action: lead.action,
      Email: lead.email,
      "Email check": lead.checks?.email?.status ?? "",
      "Website check": lead.checks?.website?.status ?? "",
      Contact: lead.contact,
      Title: lead.title,
      Employees: lead.employees,
      Revenue: lead.revenue,
      "Company LinkedIn": lead.linkedin ?? "",
      "What they do": lead.checks?.website?.description || lead.checks?.website?.title || "",
      "Still unknown": (lead.unknowns ?? []).join("; "),
      "Why this score": (lead.reasons ?? []).map((r) => `${r.label} ${r.points}/${r.max}`).join("; "),
      "AI note": lead.note?.why ?? "",
      "AI opening line": lead.note?.opener ?? "",
    };
  });
  return Papa.unparse(rows);
}
