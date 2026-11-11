"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import type { PayDeduction, PayEarning, PayrollSettings, PfRuleChange } from "@/types/payroll";
import { collegeQs, payrollFetch, selectClass } from "./payrollClient";

// Pay parts (earnings) and deduction rules of a college. Accounts edit; the College Office reads.
// A part or deduction once saved can be retired but never removed, so old months still explain themselves.

const KIND_LABEL: Record<PayDeduction["kind"], string> = {
  PF: "Percent of PF wage, capped", ESI: "ESI (percent of ESI wage, under a wage limit)", SLAB: "Slab on gross (e.g. PT)",
  FLAT: "Fixed amount", INCOME_TAX: "Income tax (worked out)", ADVANCE: "Salary advance recovery", MANUAL: "Entered each month",
};
const num = (v: string) => (v === "" ? 0 : Number(v));

export function PayRules({ collegeId }: { collegeId?: string }) {
  const [saved, setSaved] = useState<{ settings: PayrollSettings; saved: boolean; canEdit: boolean } | null>(null);
  const [s, setS] = useState<PayrollSettings | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/college/payroll/settings${collegeQs(collegeId)}`;

  const load = useCallback(() => {
    payrollFetch<{ settings: PayrollSettings; saved: boolean; canEdit: boolean }>(url).then((d) => {
      setSaved(d); setS(structuredClone(d.settings));
      setSavedIds(new Set(d.saved ? [...d.settings.earnings.map((e) => e.id), ...d.settings.deductions.map((x) => x.id)] : []));
    }).catch((e: Error) => setError(e.message));
  }, [url]);
  useEffect(load, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!saved || !s) return <div className="h-40 animate-pulse rounded-2xl bg-muted/40" />;
  const ro = !saved.canEdit;
  const setE = (i: number, patch: Partial<PayEarning>) => setS({ ...s, earnings: s.earnings.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const setD = (i: number, patch: Partial<PayDeduction>) => setS({ ...s, deductions: s.deductions.map((d, j) => (j === i ? ({ ...d, ...patch } as PayDeduction) : d)) });

  async function save() {
    if (!s || !saved) return;
    setBusy(true);
    try {
      await payrollFetch(url, { method: "PUT", body: JSON.stringify({ settings: s, version: saved.saved ? saved.settings.version : 0 }) });
      toast({ variant: "success", title: "Pay rules saved" });
      load();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't save" }); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {!saved.saved && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">These are the starting rules (as on the VWU pay sheet). {ro ? "Accounts haven't confirmed them yet." : "Check them and save to confirm them for this college."}</p>}

      <Card className="rounded-2xl"><CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <div><h2 className="font-semibold">Earnings</h2><p className="text-xs text-muted-foreground">Their fixed amounts add up to Gross_Actual. Loss of pay reduces a part only when &quot;Reduced by LOP&quot; is ticked.</p></div>
          {!ro && <Button size="sm" variant="outline" onClick={() => setS({ ...s, earnings: [...s.earnings, { id: "", label: "", prorate: true, pfWage: false, esiWage: false, taxable: true, active: true }] })}><Plus className="mr-1 h-4 w-4" />Add part</Button>}
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">Name</th><th className="py-1 pr-2">Code</th><th className="py-1 pr-2">Reduced by LOP</th><th className="py-1 pr-2">PF wage</th><th className="py-1 pr-2">ESI wage</th><th className="py-1 pr-2">Taxable</th><th className="py-1">In use</th></tr></thead>
          <tbody>{s.earnings.map((e, i) => (
            <tr key={i} className="border-t">
              <td className="py-1.5 pr-2"><Input aria-label="Name" disabled={ro} value={e.label} onChange={(ev) => setE(i, { label: ev.target.value })} className="h-8" /></td>
              <td className="py-1.5 pr-2"><Input aria-label="Code" disabled={ro || savedIds.has(e.id)} value={e.id} onChange={(ev) => setE(i, { id: ev.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} className="h-8 w-24 font-mono" /></td>
              {(["prorate", "pfWage", "esiWage", "taxable", "active"] as const).map((k) => (
                <td key={k} className="py-1.5 pr-2"><Checkbox aria-label={k} disabled={ro} checked={e[k]} onCheckedChange={(c) => setE(i, { [k]: !!c })} /></td>
              ))}
            </tr>
          ))}</tbody>
        </table></div>
      </CardContent></Card>

      <Card className="rounded-2xl"><CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-semibold">Deductions</h2><p className="text-xs text-muted-foreground">If there&apos;s no pay in a month, every deduction is 0. If deductions would make the net negative, the advance is reduced first.</p></div>
          {!ro && (
            <select aria-label="Add deduction" className={selectClass} value="" onChange={(ev) => {
              const kind = ev.target.value as PayDeduction["kind"];
              if (!kind) return;
              const base = { id: "", label: "", active: true };
              const d: PayDeduction = kind === "FLAT" ? { kind, ...base, amount: 0 } : kind === "SLAB" ? { kind, ...base, slabs: [{ upTo: null, amount: 0 }] }
                : kind === "PF" ? { kind, ...base, percent: 12, cap: 3000, wageCeiling: 25000, epsCeiling: 15000 } : kind === "ESI" ? { kind, ...base, percent: 0.75, wageLimit: 21000, roundUp: true } : { kind, ...base };
              setS({ ...s, deductions: [...s.deductions, d] });
            }}>
              <option value="">Add deduction...</option>
              {(["MANUAL", "FLAT", "SLAB", "PF", "ESI"] as const).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-3">{s.deductions.map((d, i) => (
          <div key={i} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label className="text-xs">Name</Label><Input disabled={ro} value={d.label} onChange={(ev) => setD(i, { label: ev.target.value })} className="h-8 w-36" /></div>
              <div className="space-y-1"><Label className="text-xs">Code</Label><Input disabled={ro || savedIds.has(d.id)} value={d.id} onChange={(ev) => setD(i, { id: ev.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} className="h-8 w-24 font-mono" /></div>
              <p className="pb-1.5 text-xs text-muted-foreground">{KIND_LABEL[d.kind]}</p>
              <label className="ml-auto flex items-center gap-2 pb-1.5 text-sm"><Checkbox disabled={ro} checked={d.active} onCheckedChange={(c) => setD(i, { active: !!c })} />In use</label>
            </div>
            {d.kind === "PF" && <PfRuleFields d={d} ro={ro} onChange={(patch) => setD(i, patch)} />}
            {d.kind === "ESI" && (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="space-y-1"><Label className="text-xs">Percent of ESI wage</Label><Input disabled={ro} inputMode="decimal" value={d.percent} onChange={(ev) => setD(i, { percent: num(ev.target.value) })} className="h-8 w-24" /></div>
                <div className="space-y-1"><Label className="text-xs">Applies up to a full monthly wage of (Rs.)</Label><Input disabled={ro} inputMode="numeric" value={d.wageLimit} onChange={(ev) => setD(i, { wageLimit: num(ev.target.value) })} className="h-8 w-28" /></div>
                <label className="flex items-center gap-2 pb-1.5 text-sm"><Checkbox disabled={ro} checked={d.roundUp} onCheckedChange={(c) => setD(i, { roundUp: !!c })} />Round up</label>
              </div>
            )}
            {d.kind === "FLAT" && (
              <div className="mt-2 space-y-1"><Label className="text-xs">Amount (Rs.)</Label><Input disabled={ro} inputMode="numeric" value={d.amount} onChange={(ev) => setD(i, { amount: num(ev.target.value) })} className="h-8 w-28" /></div>
            )}
            {d.kind === "SLAB" && (
              <div className="mt-2 space-y-1.5">
                <p className="text-xs text-muted-foreground">On the month&apos;s earned gross. The last slab is &quot;and above&quot;.</p>
                {d.slabs.map((sl, k) => (
                  <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-20 text-xs text-muted-foreground">{k === 0 ? "Up to" : sl.upTo === null ? "Above" : "Then up to"}</span>
                    {sl.upTo !== null ? <Input disabled={ro} inputMode="numeric" value={sl.upTo} onChange={(ev) => setD(i, { slabs: d.slabs.map((x, j) => (j === k ? { ...x, upTo: num(ev.target.value) } : x)) })} className="h-8 w-28" /> : <span className="w-28 text-xs">{rupeesOr(d.slabs[k - 1]?.upTo)}</span>}
                    <span className="text-xs">-&gt; Rs.</span>
                    <Input disabled={ro} inputMode="numeric" value={sl.amount} onChange={(ev) => setD(i, { slabs: d.slabs.map((x, j) => (j === k ? { ...x, amount: num(ev.target.value) } : x)) })} className="h-8 w-24" />
                    {!ro && sl.upTo !== null && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setD(i, { slabs: d.slabs.filter((_, j) => j !== k) })}>Remove</Button>}
                  </div>
                ))}
                {!ro && <Button size="sm" variant="outline" onClick={() => { const last = d.slabs[d.slabs.length - 1]; const prev = d.slabs[d.slabs.length - 2]?.upTo ?? 0; setD(i, { slabs: [...d.slabs.slice(0, -1), { upTo: prev + 1000, amount: 0 }, last] }); }}>Add slab</Button>}
              </div>
            )}
          </div>
        ))}</div>
      </CardContent></Card>

      <Card className="rounded-2xl"><CardContent className="grid gap-4 p-5 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="pr-basis">Days in a month</Label>
          <select id="pr-basis" disabled={ro} className={`${selectClass} w-full`} value={s.payDayBasis} onChange={(e) => setS({ ...s, payDayBasis: e.target.value as PayrollSettings["payDayBasis"] })}>
            <option value="CALENDAR">Calendar days (28-31)</option><option value="FIXED_30">Always 30</option>
          </select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="pr-tds">Monthly TDS rounded to</Label>
          <select id="pr-tds" disabled={ro} className={`${selectClass} w-full`} value={s.tdsRoundTo} onChange={(e) => setS({ ...s, tdsRoundTo: Number(e.target.value) })}>
            <option value={100}>Rs. 100</option><option value={10}>Rs. 10</option><option value={1}>Rs. 1</option>
          </select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="pr-sig">Signatures under the register</Label>
          <Input id="pr-sig" disabled={ro} value={s.signatureLabels.join(", ")} onChange={(e) => setS({ ...s, signatureLabels: e.target.value.split(",").map((x) => x.trimStart()) })} />
          <p className="text-xs text-muted-foreground">Separate with commas.</p>
        </div>
      </CardContent></Card>

      {!ro && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? "Saving..." : saved.saved ? "Save rules" : "Confirm and save rules"}</Button>
          <Button variant="ghost" onClick={() => setS(structuredClone(saved.settings))} disabled={busy}>Undo changes</Button>
          {saved.settings.updatedAt && <p className="text-xs text-muted-foreground">Last saved {new Date(saved.settings.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{saved.settings.updatedByName ? ` by ${saved.settings.updatedByName}` : ""}</p>}
        </div>
      )}
    </div>
  );
}

const rupeesOr = (v: number | null | undefined) => (typeof v === "number" ? `Rs. ${v.toLocaleString("en-IN")}` : "");

// PF: percent of the PF wage, counted up to the wage ceiling (the most PF a month = percent x ceiling), plus the
// pension (EPS) ceiling for the EPFO return. A government change is added as a rule from a month on - months
// before it keep the earlier rule, so a released or re-worked month is never priced with the wrong one.
type PfDeduction = Extract<PayDeduction, { kind: "PF" }>;
function PfRuleFields({ d, ro, onChange }: { d: PfDeduction; ro: boolean; onChange: (patch: Partial<PfDeduction>) => void }) {
  const ceiling = d.wageCeiling ?? (d.percent > 0 ? Math.round((d.cap * 100) / d.percent) : 0);
  const eps = d.epsCeiling ?? 15000;
  const max = (r: { percent: number; wageCeiling: number }) => Math.round((r.wageCeiling * r.percent) / 100);
  const changes = d.changes ?? [];
  const setBase = (patch: Partial<{ percent: number; wageCeiling: number; epsCeiling: number }>) => {
    const next = { percent: d.percent, wageCeiling: ceiling, epsCeiling: eps, ...patch };
    onChange({ ...next, cap: max(next) });
  };
  const setChange = (k: number, patch: Partial<PfRuleChange>) => onChange({ changes: changes.map((c, j) => (j === k ? { ...c, ...patch } : c)) });
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label className="text-xs">{changes.length ? "Before the first change: percent" : "Percent of PF wage"}</Label><Input disabled={ro} inputMode="decimal" value={d.percent} onChange={(ev) => setBase({ percent: num(ev.target.value) })} className="h-8 w-24" /></div>
        <div className="space-y-1"><Label className="text-xs">PF wage ceiling (Rs.)</Label><Input disabled={ro} inputMode="numeric" value={ceiling} onChange={(ev) => setBase({ wageCeiling: num(ev.target.value) })} className="h-8 w-28" /></div>
        <div className="space-y-1"><Label className="text-xs">Pension (EPS) wage ceiling (Rs.)</Label><Input disabled={ro} inputMode="numeric" value={eps} onChange={(ev) => setBase({ epsCeiling: num(ev.target.value) })} className="h-8 w-28" /></div>
        <p className="pb-1.5 text-xs text-muted-foreground">Most PF a month: Rs. {max({ percent: d.percent, wageCeiling: ceiling }).toLocaleString("en-IN")}</p>
      </div>
      {changes.map((c, k) => (
        <div key={k} className="flex flex-wrap items-end gap-3 rounded-md bg-muted/40 p-2">
          <div className="space-y-1"><Label className="text-xs">From month</Label><Input disabled={ro} type="month" value={c.from} onChange={(ev) => setChange(k, { from: ev.target.value })} className="h-8 w-40" /></div>
          <div className="space-y-1"><Label className="text-xs">Percent</Label><Input disabled={ro} inputMode="decimal" value={c.percent} onChange={(ev) => setChange(k, { percent: num(ev.target.value) })} className="h-8 w-20" /></div>
          <div className="space-y-1"><Label className="text-xs">PF wage ceiling</Label><Input disabled={ro} inputMode="numeric" value={c.wageCeiling} onChange={(ev) => setChange(k, { wageCeiling: num(ev.target.value) })} className="h-8 w-28" /></div>
          <div className="space-y-1"><Label className="text-xs">EPS ceiling</Label><Input disabled={ro} inputMode="numeric" value={c.epsCeiling} onChange={(ev) => setChange(k, { epsCeiling: num(ev.target.value) })} className="h-8 w-28" /></div>
          <p className="pb-1.5 text-xs text-muted-foreground">Most PF: Rs. {max(c).toLocaleString("en-IN")}</p>
          {!ro && <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => onChange({ changes: changes.filter((_, j) => j !== k) })}>Remove</Button>}
        </div>
      ))}
      {!ro && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ changes: [...changes, { from: thisMonth, percent: d.percent, wageCeiling: ceiling, epsCeiling: eps }] })}>
          <Plus className="mr-1 h-4 w-4" />PF rule changes from a month
        </Button>
      )}
      <p className="text-xs text-muted-foreground">Each month uses the latest rule starting on or before it. A month already prepared picks up a change on Recalculate; released months never change.</p>
    </div>
  );
}
