// Small shared pieces: the coloured pills and labels used across the screen.

const TIER_STYLES = {
  A: "bg-emerald-600 text-white",
  B: "bg-amber-500 text-white",
  C: "bg-slate-300 text-slate-700",
};

const TONE_STYLES = {
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  bad: "bg-rose-50 text-rose-700 ring-rose-200",
  unknown: "bg-slate-100 text-slate-600 ring-slate-200",
};

export const TONE_BAR = { good: "bg-emerald-500", warn: "bg-amber-400", bad: "bg-rose-400", unknown: "bg-slate-400" };

const EMAIL_LABELS = {
  valid: ["good", "Valid"],
  unknown: ["unknown", "Unverified"],
  missing: ["bad", "None"],
  invalid_format: ["bad", "Malformed"],
  no_mail_server: ["bad", "No mail server"],
};

const WEBSITE_LABELS = {
  live: ["good", "Live"],
  restricted: ["warn", "Blocks bots"],
  dead: ["bad", "Dead"],
  missing: ["bad", "None"],
  skipped_private: ["bad", "Private address"],
};

export function TierBadge({ tier }) {
  return <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${TIER_STYLES[tier]}`}>{tier}</span>;
}

export function Pill({ tone, children }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_STYLES[tone]}`}>{children}</span>;
}

export function EmailPill({ check }) {
  const [tone, label] = EMAIL_LABELS[check?.status] ?? EMAIL_LABELS.unknown;
  const kind = check?.kind === "role" ? " · shared inbox" : check?.kind === "free" ? " · webmail" : "";
  return <Pill tone={check?.kind === "role" || check?.kind === "free" ? "warn" : tone}>{label + kind}</Pill>;
}

export function WebsitePill({ check }) {
  const [tone, label] = WEBSITE_LABELS[check?.status] ?? ["unknown", "Unchecked"];
  return <Pill tone={tone}>{label}</Pill>;
}
