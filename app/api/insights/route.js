// POST /api/insights  { leads, profile }  ->  { notes: [{ id, why, opener }] }
// Called only when the user asks for AI notes on the leads currently in tier A.

import { generateInsights, MAX_INSIGHT_LEADS } from "@/lib/insight";
import { DEFAULT_PROFILE } from "@/lib/score";

export const maxDuration = 60;

function fail(status, error) {
  return Response.json({ error }, { status });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Request body must be JSON.");
  }
  const leads = body?.leads;
  if (!Array.isArray(leads) || !leads.length) return fail(400, "No leads were sent.");
  if (leads.length > MAX_INSIGHT_LEADS) return fail(413, `AI notes are limited to ${MAX_INSIGHT_LEADS} leads at a time.`);
  if (!leads.every((lead) => lead && Number.isInteger(lead.id))) return fail(400, "Every lead needs a numeric id.");

  const profile = { ...DEFAULT_PROFILE, ...(body.profile ?? {}) };
  if (!Array.isArray(profile.includeKeywords)) return fail(400, "Profile keywords must be a list.");

  try {
    return Response.json({ notes: await generateInsights(leads, profile) });
  } catch (err) {
    if (err.status) return fail(err.status, err.message);
    console.error("insights failed:", err.message);
    return fail(502, "Could not reach the AI service.");
  }
}
