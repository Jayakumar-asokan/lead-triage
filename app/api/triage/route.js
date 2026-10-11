// POST /api/triage  { csv: "<file contents>" }  ->  { leads, stats }
// Cleans and validates on the server (DNS and website checks cannot run in a browser).
// Scoring happens in the browser so changing the target profile re-ranks instantly.

import { cleanCsv } from "@/lib/clean";
import { validateWithCache } from "@/lib/cache";

export const maxDuration = 60;

const MAX_CSV_CHARS = 1_000_000;
const MAX_LEADS = 500;

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
  const csv = body?.csv;
  if (typeof csv !== "string" || !csv.trim()) return fail(400, "The file is empty.");
  if (csv.length > MAX_CSV_CHARS) return fail(413, "The file is larger than 1 MB. Split it and upload in parts.");

  const { leads, stats } = cleanCsv(csv);
  if (!leads.length) return fail(422, "No leads found. The first row must be a header with a company, website or email column.");
  if (leads.length > MAX_LEADS) return fail(413, `The file has ${leads.length} unique leads; the limit is ${MAX_LEADS} per upload.`);

  const { leads: checked, cache } = await validateWithCache(leads);
  return Response.json({ leads: checked.map((lead, id) => ({ id, ...lead })), stats: { ...stats, cache } });
}
