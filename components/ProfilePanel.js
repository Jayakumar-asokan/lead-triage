// The buyer's target profile. Editing any field re-ranks the list straight away.

function NumberField({ label, suffix, value, onChange }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <span className="mt-1 flex items-center rounded-md border border-slate-300 bg-white focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
        <input
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md bg-transparent px-2 py-1.5 text-sm text-slate-900 outline-none"
        />
        {suffix && <span className="pr-2 text-xs text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

function TextField({ label, hint, value, onChange }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <input
        type="text"
        value={value}
        placeholder={hint}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
      />
    </label>
  );
}

export default function ProfilePanel({ form, onChange, onReset }) {
  const set = (field) => (value) => onChange({ ...form, [field]: value });
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Target profile</h2>
        <button type="button" onClick={onReset} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
          Reset
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Describe the company you want to buy or sell to. The list re-ranks as you type.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField label="Revenue from" suffix="$M" value={form.revenueMinM} onChange={set("revenueMinM")} />
        <NumberField label="Revenue to" suffix="$M" value={form.revenueMaxM} onChange={set("revenueMaxM")} />
        <NumberField label="Employees from" value={form.employeesMin} onChange={set("employeesMin")} />
        <NumberField label="Employees to" value={form.employeesMax} onChange={set("employeesMax")} />
      </div>
      <div className="mt-3 space-y-3">
        <TextField label="Industries to target" hint="software, services" value={form.include} onChange={set("include")} />
        <TextField label="Industries to exclude" hint="e.g. non-profit, agency" value={form.exclude} onChange={set("exclude")} />
      </div>
    </section>
  );
}
