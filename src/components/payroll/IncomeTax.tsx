"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileText, Pencil, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { parseCSVWithRowNumbers, parseExcelFileWithRowNumbers, readFileAsText } from "@/lib/utils/csv";
import { TAX_IMPORT_HEADERS, type TaxImportPlanRow } from "@/lib/payroll/taxImport";
import type { PayrollTaxProfile, PayrollTaxRules, RegimeRules } from "@/types/payroll";
import { collegeQs, monthLabel, payrollFetch, rupees, selectClass, thisMonth } from "./payrollClient";

// Income tax (Accounts): confirm the financial year's tax rules (no TDS is worked out until they are),
// load what was paid before payroll moved into the app, and keep each person's regime and declarations.
// Every month's run works out TDS from these; the estimate here treats this month as a full month.

const fyOf = (m: string) => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5)); const s = mo >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };

type Row = {
  employeeKey: string; employeeCode: string; name: string; department: string; status: string; profile: PayrollTaxProfile; hasProfile: boolean; declared: boolean;
  estimate: { annualTax: number; deductedBefore: number; tdsNow: number; otherRegimeTax: number | null; annualSalary: number } | null;
};

export function IncomeTax({ collegeId }: { collegeId?: string }) {
  const nowFy = fyOf(thisMonth());
  const [fy, setFy] = useState(nowFy);
  const fys = [fyOf(`${Number(nowFy.slice(0, 4)) - 1}-06`), nowFy, fyOf(`${Number(nowFy.slice(0, 4)) + 1}-06`)];
  const [d, setD] = useState<{ fy: string; month: string; rulesConfirmed: boolean; rows: Row[] } | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [statementOf, setStatementOf] = useState<Row | null>(null);
  const qs = (extra: Record<string, string> = {}) => collegeQs(collegeId, { fy, ...extra });
  const load = useCallback(() => {
    payrollFetch<{ fy: string; month: string; rulesConfirmed: boolean; rows: Row[] }>(`/api/college/payroll/tax/profiles${collegeQs(collegeId, { fy })}`)
      .then((x) => { setD(x); setError(""); }).catch((e: Error) => setError(e.message));
  }, [collegeId, fy]);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (d?.rows ?? []).filter((r) => !s || `${r.employeeCode} ${r.name} ${r.department}`.toLowerCase().includes(s));
  }, [d, q]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!d) return <div className="h-40 animate-pulse rounded-2xl bg-muted/40" />;
  const total = rows.reduce((a, r) => ({ tax: a.tax + (r.estimate?.annualTax ?? 0), done: a.done + (r.estimate?.deductedBefore ?? 0), now: a.now + (r.estimate?.tdsNow ?? 0) }), { tax: 0, done: 0, now: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="it-fy">Financial year</Label>
          <select id="it-fy" className={selectClass} value={fy} onChange={(e) => setFy(e.target.value)}>{fys.map((f) => <option key={f} value={f}>FY {f}</option>)}</select>
        </div>
        <Button variant="outline" onClick={() => setRulesOpen(true)}>{d.rulesConfirmed ? "Tax rules" : "Confirm tax rules"}</Button>
        <Button variant="outline" onClick={() => setImporting(true)}><Upload className="mr-1.5 h-4 w-4" />Import paid so far</Button>
        <div className="relative min-w-[14rem] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search" className="pl-8" placeholder="Emp Code, name, department" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {!d.rulesConfirmed && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">The FY {fy} tax rules aren&apos;t confirmed yet, so no income tax is worked out in the monthly salaries. Check the slabs and save them.</p>}
      <p className="text-xs text-muted-foreground">Estimate as of {monthLabel(d.month)} (taken as a full month at current pay). Total for the list: tax Rs. {rupees(total.tax)} · deducted Rs. {rupees(total.done)} · {monthLabel(d.month)} TDS Rs. {rupees(total.now)}.</p>

      <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">Person</th><th className="px-3 py-2">Regime</th><th className="px-3 py-2 text-right">Salary (year)</th><th className="px-3 py-2 text-right">Tax (year)</th><th className="px-3 py-2 text-right">Deducted</th><th className="px-3 py-2 text-right">This month</th><th className="px-3 py-2 text-right">Other regime</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>{rows.map((r) => {
            const cheaper = r.estimate?.otherRegimeTax !== null && r.estimate?.otherRegimeTax !== undefined && r.estimate.otherRegimeTax < r.estimate.annualTax;
            return (
              <tr key={r.employeeKey} className="border-t">
                <td className="px-3 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground"><span className="font-mono">{r.employeeCode}</span> · {r.department}</div></td>
                <td className="px-3 py-2">{r.profile.regime === "NEW" ? "New" : "Old"}{!r.hasProfile && <span className="ml-1 text-xs text-muted-foreground">(default)</span>}{r.profile.opening && <div className="text-xs text-muted-foreground">opening to {monthLabel(r.profile.opening.upToMonth)}</div>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.estimate ? rupees(r.estimate.annualSalary) : "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.estimate && d.rulesConfirmed ? rupees(r.estimate.annualTax) : "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.estimate ? rupees(r.estimate.deductedBefore) : "-"}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{r.estimate && d.rulesConfirmed ? rupees(r.estimate.tdsNow) : "-"}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", cheaper && "font-medium text-emerald-700 dark:text-emerald-300")}>{r.estimate?.otherRegimeTax != null ? rupees(r.estimate.otherRegimeTax) : "-"}{cheaper && <div className="text-xs">lower</div>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatementOf(r)}><FileText className="mr-1 h-3.5 w-3.5" />Statement</Button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Nobody with pay set.</td></tr>}</tbody>
        </table>
      </CardContent></Card>

      {rulesOpen && <RulesDialog url={`/api/college/payroll/tax/rules${qs()}`} fy={fy} onClose={() => setRulesOpen(false)} onSaved={() => { setRulesOpen(false); load(); }} />}
      {importing && <OpeningImport url={`/api/college/payroll/tax/import${qs()}`} parseUrl={`/api/college/payroll/parse-excel${collegeQs(collegeId)}`} fy={fy} people={d.rows} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
      {editing && <ProfileDialog url={`/api/college/payroll/tax/profiles/${encodeURIComponent(editing.employeeKey)}${qs()}`} row={editing} fy={fy} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {statementOf && <StatementDialog url={`/api/college/payroll/tax/statement/${encodeURIComponent(statementOf.employeeKey)}${qs()}`} onClose={() => setStatementOf(null)} />}
    </div>
  );
}

// ─── Rules ──────────────────────────────────────────────────────────────────────

const num = (v: string) => (v === "" ? 0 : Number(v));

function RegimeEditor({ label, r, set }: { label: string; r: RegimeRules; set: (r: RegimeRules) => void }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="font-medium">{label}</p>
      <div className="space-y-1">{r.slabs.map((s, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-24 text-xs text-muted-foreground">{i === 0 ? "Up to" : s.upTo === null ? "Above" : "Then up to"}</span>
          {s.upTo !== null ? <Input className="h-8 w-32" inputMode="numeric" value={s.upTo} onChange={(e) => set({ ...r, slabs: r.slabs.map((x, j) => (j === i ? { ...x, upTo: num(e.target.value) } : x)) })} /> : <span className="w-32 text-xs">Rs. {rupees(r.slabs[i - 1]?.upTo ?? 0)}</span>}
          <Input className="h-8 w-20" inputMode="decimal" value={s.rate} onChange={(e) => set({ ...r, slabs: r.slabs.map((x, j) => (j === i ? { ...x, rate: num(e.target.value) } : x)) })} /><span className="text-xs">%</span>
          {s.upTo !== null && r.slabs.length > 2 && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => set({ ...r, slabs: r.slabs.filter((_, j) => j !== i) })}>Remove</Button>}
        </div>
      ))}
        <Button size="sm" variant="outline" onClick={() => { const last = r.slabs[r.slabs.length - 1]; const prev = r.slabs[r.slabs.length - 2]?.upTo ?? 0; set({ ...r, slabs: [...r.slabs.slice(0, -1), { upTo: prev + 400000, rate: last.rate }, last] }); }}>Add slab</Button>
      </div>
      <div className="flex flex-wrap gap-3">
        {([["Standard deduction", "standardDeduction"], ["87A: income up to", "rebateIncomeLimit"], ["87A: rebate up to", "rebateMax"]] as const).map(([l, k]) => (
          <div key={k} className="space-y-1"><Label className="text-xs">{l}</Label><Input className="h-8 w-32" inputMode="numeric" value={r[k]} onChange={(e) => set({ ...r, [k]: num(e.target.value) })} /></div>
        ))}
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm"><Checkbox checked={r.rebateMarginalRelief} onCheckedChange={(c) => set({ ...r, rebateMarginalRelief: !!c })} />Marginal relief above the 87A limit</label>
      </div>
      <p className="text-xs text-muted-foreground">Surcharge: {r.surcharge.map((s) => `${s.rate}% above Rs. ${rupees(s.above)}`).join(" · ")} (with marginal relief)</p>
    </div>
  );
}

function RulesDialog({ url, fy, onClose, onSaved }: { url: string; fy: string; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<{ saved: boolean; rules: PayrollTaxRules; earnings: { id: string; label: string }[] } | null>(null);
  const [r, setR] = useState<PayrollTaxRules | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { payrollFetch<{ saved: boolean; rules: PayrollTaxRules; earnings: { id: string; label: string }[] }>(url).then((x) => { setD(x); setR(x.rules); }).catch(() => undefined); }, [url]);
  async function save() {
    if (!r || !d) return;
    setBusy(true);
    try {
      await payrollFetch(url, { method: "PUT", body: JSON.stringify({ rules: r, version: d.saved ? d.rules.version : 0 }) });
      toast({ variant: "success", title: `FY ${fy} tax rules saved` }); onSaved();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Income tax rules - FY {fy}</DialogTitle>
          <DialogDescription>{d?.saved ? `Saved by ${d.rules.updatedByName ?? "Accounts"}.` : "Not confirmed yet - these are the FY 2026-27 values. Check them against the Finance Act and save to confirm."} A change reaches open months when they are recalculated.</DialogDescription>
        </DialogHeader>
        {!r || !d ? <div className="h-40 animate-pulse rounded bg-muted/40" /> : (
          <div className="space-y-3">
            <RegimeEditor label="New regime (default)" r={r.newRegime} set={(x) => setR({ ...r, newRegime: x })} />
            <RegimeEditor label="Old regime" r={r.oldRegime} set={(x) => setR({ ...r, oldRegime: x })} />
            <div className="flex flex-wrap gap-3 rounded-lg border p-3">
              <div className="space-y-1"><Label className="text-xs">Cess %</Label><Input className="h-8 w-20" inputMode="decimal" value={r.cessPercent} onChange={(e) => setR({ ...r, cessPercent: num(e.target.value) })} /></div>
              {([["80C limit", "c80C"], ["80CCD(1B) limit", "c80CCD1B"], ["80D limit", "c80D"], ["24(b) limit", "c24b"]] as const).map(([l, k]) => (
                <div key={k} className="space-y-1"><Label className="text-xs">{l}</Label><Input className="h-8 w-28" inputMode="numeric" value={r.caps[k]} onChange={(e) => setR({ ...r, caps: { ...r.caps, [k]: num(e.target.value) } })} /></div>
              ))}
            </div>
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <p className="font-medium">For the HRA exemption (old regime)</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-muted-foreground">Basic =</span>
                {d.earnings.map((e) => <label key={e.id} className="flex items-center gap-1.5"><Checkbox checked={r.basicParts.includes(e.id)} onCheckedChange={(c) => setR({ ...r, basicParts: c ? [...r.basicParts, e.id] : r.basicParts.filter((x) => x !== e.id) })} />{e.label}</label>)}
              </div>
              <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">HRA part</span>
                <select className={selectClass} value={r.hraPart ?? ""} onChange={(e) => setR({ ...r, hraPart: e.target.value || null })}><option value="">None</option>{d.earnings.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
              </div>
            </div>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !r}>{d?.saved ? "Save" : "Confirm and save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── A person's profile ─────────────────────────────────────────────────────────

function ProfileDialog({ url, row, fy, onClose, onSaved }: { url: string; row: Row; fy: string; onClose: () => void; onSaved: () => void }) {
  const p0 = row.profile;
  const [p, setP] = useState(() => ({ ...p0, declarations: { ...p0.declarations }, previousEmployer: { ...p0.previousEmployer } }));
  const [hasOpening, setHasOpening] = useState(!!p0.opening);
  const [opening, setOpening] = useState(p0.opening ?? { upToMonth: `${fy.slice(0, 4)}-09`, gross: 0, hra: 0, basic: 0, tds: 0, pf: 0, pt: 0 });
  const [busy, setBusy] = useState(false);
  const field = (label: string, value: number, set: (n: number) => void) => (
    <div className="space-y-1"><Label className="text-xs">{label}</Label><Input className="h-8 w-32" inputMode="numeric" value={value || ""} onChange={(e) => set(Number(e.target.value.replace(/[^\d]/g, "")) || 0)} /></div>
  );
  async function save() {
    setBusy(true);
    try {
      const { opening: _o, ...rest } = p;
      void _o;
      await payrollFetch(url, { method: "PUT", body: JSON.stringify({ rev: p0.rev, profile: { ...rest, ...(hasOpening ? { opening } : {}) } }) });
      toast({ variant: "success", title: "Saved - open months pick it up on Recalculate" }); onSaved();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }
  const d = p.declarations;
  const setD = (k: keyof typeof d, v: number | boolean) => setP({ ...p, declarations: { ...d, [k]: v } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{row.name} - FY {fy}</DialogTitle><DialogDescription>{row.employeeCode} · {row.department}</DialogDescription></DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-4">
            {(["NEW", "OLD"] as const).map((r) => <label key={r} className="flex items-center gap-2"><input type="radio" name="regime" checked={p.regime === r} onChange={() => setP({ ...p, regime: r })} />{r === "NEW" ? "New regime" : "Old regime"}</label>)}
          </div>
          <div className="space-y-2"><p className="font-medium">Declarations {p.regime === "NEW" && <span className="text-xs font-normal text-muted-foreground">(used only in the old regime)</span>}</p>
            <div className="flex flex-wrap gap-3">
              {field("80C (besides PF)", d.c80C, (n) => setD("c80C", n))}{field("80CCD(1B) NPS", d.c80CCD1B, (n) => setD("c80CCD1B", n))}{field("80D health insurance", d.c80D, (n) => setD("c80D", n))}
              {field("Housing loan interest", d.c24b, (n) => setD("c24b", n))}{field("Other deductions", d.other, (n) => setD("other", n))}{field("Rent paid (year)", d.rentPaid, (n) => setD("rentPaid", n))}
              <label className="flex items-center gap-2 self-end pb-1.5"><Checkbox checked={d.metro} onCheckedChange={(c) => setD("metro", !!c)} />Metro city</label>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {field("Other income (year)", p.otherIncome, (n) => setP({ ...p, otherIncome: n }))}
            {field("Previous employer salary", p.previousEmployer.salary, (n) => setP({ ...p, previousEmployer: { ...p.previousEmployer, salary: n } }))}
            {field("Previous employer TDS", p.previousEmployer.tds, (n) => setP({ ...p, previousEmployer: { ...p.previousEmployer, tds: n } }))}
            {field("Previous employer PT", p.previousEmployer.pt, (n) => setP({ ...p, previousEmployer: { ...p.previousEmployer, pt: n } }))}
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <label className="flex items-center gap-2 font-medium"><Checkbox checked={hasOpening} onCheckedChange={(c) => setHasOpening(!!c)} />Paid before payroll moved into the app</label>
            {hasOpening && (
              <div className="flex flex-wrap gap-3">
                <div className="space-y-1"><Label className="text-xs">April up to</Label><Input type="month" className="h-8 w-40" value={opening.upToMonth} onChange={(e) => e.target.value && setOpening({ ...opening, upToMonth: e.target.value })} /></div>
                {field("Gross paid", opening.gross, (n) => setOpening({ ...opening, gross: n }))}{field("Basic paid", opening.basic, (n) => setOpening({ ...opening, basic: n }))}{field("HRA paid", opening.hra, (n) => setOpening({ ...opening, hra: n }))}
                {field("TDS deducted", opening.tds, (n) => setOpening({ ...opening, tds: n }))}{field("PF deducted", opening.pf, (n) => setOpening({ ...opening, pf: n }))}{field("PT deducted", opening.pt, (n) => setOpening({ ...opening, pt: n }))}
              </div>
            )}
          </div>
          {(p0.history ?? []).length > 0 && <details><summary className="cursor-pointer text-xs font-medium">History</summary><ul className="mt-1 text-xs text-muted-foreground">{[...(p0.history ?? [])].reverse().map((h, i) => <li key={i}>{new Date(h.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {h.byName}: {h.change}</li>)}</ul></details>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Statement ──────────────────────────────────────────────────────────────────

type Statement = {
  fy: string; month: string; rulesConfirmed: boolean; profile: PayrollTaxProfile;
  person: { name: string; employeeCode: string; department: string; designation: string };
  estimate: null | { tdsNow: number; otherRegimeTax: number | null; calc: { annualTax: number; deductedBefore: number; monthsLeft: number }; breakdown: null | { salary: number; hraExemption: number; standardDeduction: number; ptDeduction: number; otherIncome: number; houseLoss: number; chapterVIA: number; taxableIncome: number; tax: { slabTax: number; rebate: number; surcharge: number; cess: number; total: number } } };
  released: { month: string; gross: number; tds: number; beforeOpening: boolean }[];
  projectedMonths: string[];
};

function L({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return <div className={cn("flex justify-between", strong && "border-t pt-1 font-semibold")}><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{rupees(Math.round(v))}</span></div>;
}

function StatementDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const [s, setS] = useState<Statement | null>(null);
  useEffect(() => { payrollFetch<Statement>(url).then(setS).catch(() => undefined); }, [url]);
  const b = s?.estimate?.breakdown;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Tax statement{s ? ` - FY ${s.fy}` : ""}</DialogTitle><DialogDescription>{s ? `${s.person.name} · ${s.person.employeeCode} · ${s.profile.regime === "NEW" ? "New" : "Old"} regime · as of ${monthLabel(s.month)}` : "Loading..."}</DialogDescription></DialogHeader>
        {s && !s.rulesConfirmed && <p className="text-sm text-amber-700">The year&apos;s tax rules aren&apos;t confirmed - no tax worked out.</p>}
        {s && b && (
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <L k="Salary for the year" v={b.salary} />
              {b.hraExemption > 0 && <L k="Less HRA exemption" v={b.hraExemption} />}
              <L k="Less standard deduction" v={b.standardDeduction} />
              {b.ptDeduction > 0 && <L k="Less professional tax" v={b.ptDeduction} />}
              {b.otherIncome > 0 && <L k="Add other income" v={b.otherIncome} />}
              {b.houseLoss > 0 && <L k="Less housing loan interest" v={b.houseLoss} />}
              {b.chapterVIA > 0 && <L k="Less Chapter VI-A (80C incl. PF, 80CCD, 80D)" v={b.chapterVIA} />}
              <L k="Taxable income" v={b.taxableIncome} strong />
            </div>
            <div className="space-y-1">
              <L k="Tax on slabs" v={b.tax.slabTax} />
              {b.tax.rebate > 0 && <L k="Less rebate 87A" v={b.tax.rebate} />}
              {b.tax.surcharge > 0 && <L k="Surcharge" v={b.tax.surcharge} />}
              <L k="Cess" v={b.tax.cess} />
              <L k="Tax for the year" v={b.tax.total} strong />
              <L k="Deducted so far" v={s.estimate!.calc.deductedBefore} />
              <L k={`${monthLabel(s.month)} TDS (${s.estimate!.calc.monthsLeft} months left)`} v={s.estimate!.tdsNow} strong />
              {s.estimate!.otherRegimeTax !== null && <p className="pt-1 text-xs text-muted-foreground">In the {s.profile.regime === "NEW" ? "old" : "new"} regime the year&apos;s tax would be Rs. {rupees(s.estimate!.otherRegimeTax)}.</p>}
            </div>
          </div>
        )}
        {s && (
          <div className="space-y-1 border-t pt-3 text-sm">
            <p className="font-medium">Month by month</p>
            <ul className="space-y-0.5 text-xs">
              {s.profile.opening && <li>Apr - {monthLabel(s.profile.opening.upToMonth)} (before the app): gross Rs. {rupees(s.profile.opening.gross)}, TDS Rs. {rupees(s.profile.opening.tds)}</li>}
              {s.released.filter((m) => !m.beforeOpening).map((m) => <li key={m.month}>{monthLabel(m.month)}: gross Rs. {rupees(m.gross)}, TDS Rs. {rupees(m.tds)}</li>)}
              {s.projectedMonths.length > 0 && <li className="text-muted-foreground">Projected at current pay: {s.projectedMonths.map(monthLabel).join(", ")}</li>}
            </ul>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Opening import ─────────────────────────────────────────────────────────────

type Plan = { rows: TaxImportPlanRow[]; unknownColumns: string[]; errors: number; applied: number };

function OpeningImport({ url, parseUrl, fy, people, onClose, onDone }: { url: string; parseUrl: string; fy: string; people: Row[]; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ headers: string[]; rows: { row: number; code: string; values: Record<string, string> }[] } | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  async function template() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Paid so far");
    ws.addRow(TAX_IMPORT_HEADERS).font = { bold: true };
    for (const p of people) ws.addRow([p.employeeCode, p.name, p.profile.regime === "OLD" ? "Old" : "New", "", "", "", "", "", "", ""]);
    ws.columns = TAX_IMPORT_HEADERS.map((h, i) => ({ width: i === 1 ? 30 : Math.max(h.length + 4, 13) }));
    const help = wb.addWorksheet("Instructions");
    [["Column", "What to enter"], ["Regime", "New or Old."], ["Paid up to", `Last month paid outside the app, e.g. Oct ${fy.slice(0, 4)}.`],
      ["Gross paid", "Salary paid from April up to that month."], ["Basic paid / HRA paid", "Only needed for the old regime's HRA exemption."],
      ["TDS / PF / PT deducted", "What was deducted from April up to that month."], [], ["Leave a person out, or their row blank under the amounts, if nothing was paid outside the app."]].forEach((r) => help.addRow(r));
    help.columns = [{ width: 24 }, { width: 90 }];
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `tax_paid_so_far_${fy}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
  }
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPlan(null); setFile(null);
    try {
      const lower = f.name.toLowerCase();
      if (lower.endsWith(".xls")) throw new Error("Save the file as .xlsx or .csv first");
      const parsed = lower.endsWith(".csv") ? parseCSVWithRowNumbers(await readFileAsText(f)) : await parseExcelFileWithRowNumbers(f, parseUrl);
      const headers = (parsed.rows[0] ?? []).map((h) => String(h ?? "").trim());
      const codeAt = headers.findIndex((h) => ["EMPCODE", "EMPLOYEECODE", "EMPLOYEEID"].includes(h.toUpperCase().replace(/[^A-Z]/g, "")));
      if (codeAt < 0) throw new Error('The file needs an "Emp Code" column');
      const paidAt = headers.findIndex((h) => h.toUpperCase().replace(/[^A-Z]/g, "") === "PAIDUPTO");
      const rows = parsed.rows.slice(1).map((r, i) => ({ row: parsed.rowNumbers[i + 1] ?? i + 2, code: String(r[codeAt] ?? "").trim(), values: Object.fromEntries(headers.map((h, j) => [h, String(r[j] ?? "").trim()])) }))
        .filter((r) => r.code && (paidAt < 0 || r.values[headers[paidAt]]));
      if (rows.length === 0) throw new Error("No rows with a 'Paid up to' month");
      setFile({ headers, rows });
      await run("preview", { headers, rows });
    } catch (err) { toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to read the file" }); }
  }
  async function run(mode: "preview" | "apply", body = file) {
    if (!body) return;
    setBusy(true);
    try {
      const d = await payrollFetch<Plan>(url, { method: "POST", body: JSON.stringify({ mode, ...body }) });
      setPlan(d);
      if (mode === "apply") { toast({ variant: "success", title: `Saved for ${d.applied} people - recalculate open months` }); onDone(); }
    } catch (err) {
      const data = (err as { data?: Plan }).data;
      if (data?.rows) setPlan(data);
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to import" });
    } finally { setBusy(false); }
  }
  const bad = plan?.rows.filter((r) => r.status === "ERROR") ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Import what was paid so far - FY {fy}</DialogTitle>
          <DialogDescription>For the months paid before payroll was moved into the application: tax regime, gross, TDS, PF and PT from April. Without these figures, TDS for the rest of the year would be incorrect. Rows without a &quot;Paid up to&quot; month are skipped; declarations already saved are kept.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={template}><Download className="mr-1.5 h-4 w-4" />Template</Button>
          <Button variant="outline" asChild><label className="cursor-pointer"><Upload className="mr-1.5 h-4 w-4" />Upload file<input type="file" accept=".xlsx,.csv" className="sr-only" onChange={pick} /></label></Button>
        </div>
        {plan && (
          <div className="space-y-2 text-sm">
            <p>{plan.rows.length - bad.length} ready · {bad.length} with problems</p>
            {plan.unknownColumns.length > 0 && <p className="text-destructive">Columns this import doesn&apos;t know: {plan.unknownColumns.join(", ")}</p>}
            <div className="max-h-72 overflow-auto rounded-md border"><table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left"><tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Emp Code</th><th className="px-2 py-1">Person / problem</th><th className="px-2 py-1">Regime</th><th className="px-2 py-1">Up to</th><th className="px-2 py-1 text-right">Gross</th><th className="px-2 py-1 text-right">TDS</th></tr></thead>
              <tbody>{[...bad, ...plan.rows.filter((r) => r.status === "OK")].map((r) => (
                <tr key={r.row} className="border-t">
                  <td className="px-2 py-1">{r.row}</td><td className="px-2 py-1 font-mono">{r.code}</td>
                  <td className={cn("px-2 py-1", r.status === "ERROR" && "text-destructive")}>{r.status === "ERROR" ? r.error : r.name}</td>
                  <td className="px-2 py-1">{r.regime ?? ""}</td><td className="px-2 py-1">{r.opening ? monthLabel(r.opening.upToMonth) : ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.opening ? rupees(r.opening.gross) : ""}</td><td className="px-2 py-1 text-right tabular-nums">{r.opening ? rupees(r.opening.tds) : ""}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={busy || !plan || plan.errors > 0 || plan.rows.length === 0} onClick={() => run("apply")}>{busy ? "Working..." : `Save for ${plan ? plan.rows.length - bad.length : 0} people`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
