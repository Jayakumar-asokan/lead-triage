"use client";

// The whole screen. Flow: upload a CSV -> server cleans and validates it ->
// the browser scores it against the target profile -> filter, inspect, export.

import { useMemo, useRef, useState } from "react";
import { DEFAULT_PROFILE, rankLeads } from "@/lib/score";
import { leadsToCsv } from "@/lib/export";
import LeadDetail from "./LeadDetail";
import LeadTable from "./LeadTable";
import ProfilePanel from "./ProfilePanel";

const DEFAULT_FORM = {
  revenueMinM: String(DEFAULT_PROFILE.revenueMin / 1e6),
  revenueMaxM: String(DEFAULT_PROFILE.revenueMax / 1e6),
  employeesMin: String(DEFAULT_PROFILE.employeesMin),
  employeesMax: String(DEFAULT_PROFILE.employeesMax),
  include: DEFAULT_PROFILE.includeKeywords.join(", "),
  exclude: DEFAULT_PROFILE.excludeKeywords.join(", "),
};

const TIERS = [
  { key: "all", label: "All" },
  { key: "A", label: "A · Contact first" },
  { key: "B", label: "B · Review" },
  { key: "C", label: "C · Skip" },
];

const toNumber = (text, fallback) => (text.trim() === "" || Number.isNaN(Number(text)) ? fallback : Number(text));
const toKeywords = (text) => text.split(",").map((k) => k.trim()).filter(Boolean);

function formToProfile(form) {
  return {
    revenueMin: toNumber(form.revenueMinM, 0) * 1e6,
    revenueMax: toNumber(form.revenueMaxM, Infinity) * 1e6,
    employeesMin: toNumber(form.employeesMin, 0),
    employeesMax: toNumber(form.employeesMax, Infinity),
    includeKeywords: toKeywords(form.include),
    excludeKeywords: toKeywords(form.exclude),
  };
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      <div className="text-xs font-medium text-slate-600">{label}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export default function TriageApp() {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [checked, setChecked] = useState([]); // cleaned + validated leads from the server
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [tier, setTier] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);

  const ranked = useMemo(() => rankLeads(checked, formToProfile(form)), [checked, form]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ranked.filter((lead) => (tier === "all" || lead.tier === tier) && (!q || [lead.company, lead.domain, lead.industry, lead.location].join(" ").toLowerCase().includes(q)));
  }, [ranked, tier, query]);
  const selected = ranked.find((lead) => lead.id === selectedId) ?? null;
  const count = (key) => ranked.filter((lead) => lead.tier === key).length;

  async function run(name, csv) {
    setStatus("loading");
    setError("");
    setFileName(name);
    setSelectedId(null);
    try {
      const response = await fetch("/api/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
      setChecked(data.leads);
      setStats(data.stats);
      setTier("all");
      setQuery("");
      setStatus("done");
    } catch (err) {
      setError(err.message || "Could not reach the server.");
      setStatus("error");
    }
  }

  async function onFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setError("Please choose a .csv file.");
      setStatus("error");
      return;
    }
    run(file.name, await file.text());
  }

  async function useSample() {
    const response = await fetch("/sample-leads.csv");
    run("sample-leads.csv", await response.text());
  }

  const busy = status === "loading";

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Lead Triage</h1>
          <p className="text-sm text-slate-600">Know which leads are worth an enrichment credit and a call before you spend either.</p>
        </div>
        {status === "done" && (
          <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Upload another file
          </button>
        )}
      </header>

      <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

      {status !== "done" && (
        <section
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
          className={`mt-6 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white"}`}
        >
          {busy ? (
            <div role="status">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
              <p className="mt-3 text-sm font-medium text-slate-900">Checking {fileName}…</p>
              <p className="text-xs text-slate-500">Merging duplicates, verifying mail servers and visiting each website. About 10 seconds for 30 leads.</p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-slate-900">Drop a lead export here</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">Any CSV with a company, website or email column works, including a SaaSquatch export. Up to 500 leads.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                  Choose a CSV file
                </button>
                <button type="button" onClick={useSample} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Try the sample data
                </button>
              </div>
              {status === "error" && <p role="alert" className="mx-auto mt-4 max-w-md rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
              <ol className="mx-auto mt-8 grid max-w-3xl gap-3 text-left text-sm text-slate-600 sm:grid-cols-3">
                <li className="rounded-lg bg-slate-50 p-3"><span className="font-semibold text-slate-900">1. Clean.</span> Duplicate rows are merged and nothing is lost.</li>
                <li className="rounded-lg bg-slate-50 p-3"><span className="font-semibold text-slate-900">2. Verify.</span> Each email domain and website is checked live.</li>
                <li className="rounded-lg bg-slate-50 p-3"><span className="font-semibold text-slate-900">3. Rank.</span> Leads are scored against your target, with reasons.</li>
              </ol>
            </>
          )}
        </section>
      )}

      {status === "done" && stats && (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Summary">
            <Stat label="Rows read" value={stats.rowsRead} hint={fileName} />
            <Stat label="Duplicates merged" value={stats.duplicatesMerged} hint={`${stats.uniqueLeads} unique leads`} />
            <Stat label="Contact first" value={count("A")} hint="Tier A" />
            <Stat label="Review" value={count("B")} hint="Tier B" />
            <Stat label="Skip" value={count("C")} hint="Saves a credit each" />
          </section>
          <p className="mt-2 text-xs text-slate-500">
            {stats.cache.lookedUp} domain {stats.cache.lookedUp === 1 ? "check" : "checks"} run live, {stats.cache.reused} reused from the last 7 days.
            {stats.unmappedHeaders.length > 0 && ` Columns not used: ${stats.unmappedHeaders.join(", ")}.`}
          </p>

          <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-4">
              <ProfilePanel form={form} onChange={setForm} onReset={() => setForm(DEFAULT_FORM)} />
              {selected && <LeadDetail lead={selected} onClose={() => setSelectedId(null)} />}
            </div>

            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by tier">
                  {TIERS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={tier === option.key}
                      onClick={() => setTier(option.key)}
                      className={`rounded-full px-3 py-1 text-sm font-medium ${tier === option.key ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"}`}
                    >
                      {option.label}
                      <span className="ml-1.5 tabular-nums opacity-70">{option.key === "all" ? ranked.length : count(option.key)}</span>
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search company, industry or city"
                  aria-label="Search leads"
                  className="min-w-[200px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  disabled={!visible.length}
                  onClick={() => download(`triaged-leads-${tier === "all" ? "all" : `tier-${tier}`}.csv`, leadsToCsv(visible))}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Export {visible.length} to CSV
                </button>
              </div>
              <LeadTable leads={visible} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
