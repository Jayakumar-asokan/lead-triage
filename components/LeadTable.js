// The ranked list. Best leads first; click a row to see why it scored that way.

import { formatMoney } from "@/lib/score";
import { EmailPill, TierBadge, WebsitePill } from "./ui";

function whatTheyDo(lead) {
  const site = lead.checks?.website ?? {};
  return site.description || lead.industry || site.title || "";
}

export default function LeadTable({ leads, selectedId, onSelect }) {
  if (!leads.length) {
    return <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No leads match these filters.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Score</th>
            <th scope="col" className="px-3 py-2 font-semibold">Company</th>
            <th scope="col" className="px-3 py-2 font-semibold">Revenue</th>
            <th scope="col" className="px-3 py-2 font-semibold">Size</th>
            <th scope="col" className="px-3 py-2 font-semibold">Email</th>
            <th scope="col" className="px-3 py-2 font-semibold">Website</th>
            <th scope="col" className="px-3 py-2 font-semibold">Next step</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {leads.map((lead) => (
            <tr
              key={lead.id}
              tabIndex={0}
              aria-selected={lead.id === selectedId}
              onClick={() => onSelect(lead.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(lead.id);
                }
              }}
              className={`cursor-pointer outline-none hover:bg-indigo-50/60 focus-visible:bg-indigo-50 ${lead.id === selectedId ? "bg-indigo-50" : ""}`}
            >
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <TierBadge tier={lead.tier} />
                  <span className="font-semibold tabular-nums text-slate-900">{lead.score}</span>
                </span>
              </td>
              <td className="max-w-[280px] px-3 py-2.5">
                <div className="truncate font-medium text-slate-900">{lead.company || lead.domain}</div>
                <div className="truncate text-xs text-slate-500">{whatTheyDo(lead)}</div>
              </td>
              <td className="px-3 py-2.5 tabular-nums text-slate-700">{lead.revenueUsd ? formatMoney(lead.revenueUsd) : <span className="text-slate-400">?</span>}</td>
              <td className="px-3 py-2.5 tabular-nums text-slate-700">{lead.employeeCount ?? <span className="text-slate-400">?</span>}</td>
              <td className="px-3 py-2.5"><EmailPill check={lead.checks?.email} /></td>
              <td className="px-3 py-2.5"><WebsitePill check={lead.checks?.website} /></td>
              <td className="px-3 py-2.5 text-slate-700">{lead.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
