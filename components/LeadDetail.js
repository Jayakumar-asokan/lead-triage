// The "why" panel: every rule that went into one lead's score.

import { EmailPill, TierBadge, TONE_BAR, WebsitePill } from "./ui";

function Fact({ label, children }) {
  if (!children) return null;
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-slate-900">{children}</dd>
    </div>
  );
}

export default function LeadDetail({ lead, onClose }) {
  const site = lead.checks?.website ?? {};
  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-4" aria-label={`Score details for ${lead.company}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900">{lead.company || lead.domain}</h2>
          {lead.domain && (
            <a href={`https://${lead.domain}`} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">
              {lead.domain}
            </a>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          ✕
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-50 p-3">
        <span className="text-3xl font-bold tabular-nums text-slate-900">{lead.score}</span>
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <TierBadge tier={lead.tier} /> {lead.action}
          </div>
          {lead.unknowns.length > 0 && <p className="mt-0.5 text-xs text-slate-500">Enrichment would settle: {lead.unknowns.join(", ").toLowerCase()}</p>}
        </div>
      </div>

      {(site.description || site.title) && (
        <p className="mt-3 text-sm text-slate-700">
          <span className="font-medium text-slate-900">From their website: </span>
          {site.description || site.title}
        </p>
      )}

      {lead.note && (
        <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">AI note · check before sending</div>
          <p className="mt-1 text-slate-800">{lead.note.why}</p>
          <p className="mt-2 text-slate-800">
            <span className="font-medium text-slate-900">Opening line: </span>
            {lead.note.opener}
          </p>
        </div>
      )}

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Why this score</h3>
      <ul className="mt-2 space-y-2.5">
        {lead.reasons.map((reason) => (
          <li key={reason.label}>
            <div className="flex justify-between text-sm">
              <span className="font-medium text-slate-900">{reason.label}</span>
              <span className="tabular-nums text-slate-600">
                {reason.points} / {reason.max}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100">
              <div className={`h-1.5 rounded-full ${TONE_BAR[reason.tone]}`} style={{ width: `${(reason.points / reason.max) * 100}%` }} />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{reason.note}</p>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</h3>
      <dl className="mt-1 divide-y divide-slate-100">
        <Fact label="Person">{[lead.contact, lead.title].filter(Boolean).join(", ")}</Fact>
        <Fact label="Email">
          {lead.email && <span className="mr-2">{lead.email}</span>}
          <EmailPill check={lead.checks?.email} />
        </Fact>
        <Fact label="Website">
          <WebsitePill check={lead.checks?.website} />
        </Fact>
        <Fact label="Phone">{lead.phone && `${lead.phone}${lead.foundOnSite?.includes("phone") ? " (from their website)" : ""}`}</Fact>
        <Fact label="LinkedIn">
          {lead.linkedin && (
            <a href={lead.linkedin} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              Company page
            </a>
          )}
        </Fact>
        <Fact label="Location">{lead.location}</Fact>
        <Fact label="Merged rows">{lead.duplicates > 0 ? `${lead.duplicates + 1} rows combined into this lead` : ""}</Fact>
      </dl>
    </aside>
  );
}
