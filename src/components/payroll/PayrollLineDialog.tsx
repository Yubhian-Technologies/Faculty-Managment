"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { PayrollLine, PayrollRun } from "@/types/payroll";
import { collegeQs, monthLabel, payrollFetch, rupees, selectClass } from "./payrollClient";
import { downloadPayslip } from "./payslipDownload";
import type { PayslipData } from "@/lib/payroll/payslip";

// One person's line: how the pay days and money were worked out, and (while the month is open) what the
// College Office can adjust - LOP days (with a reason), not credited, hold, one-off earnings (arrears),
// the month's other deductions - and, for Accounts, this month's IT and advance recovery (with a reason).

export function PayrollLineDialog({ collegeId, run, line, actor, editable, onClose, onSaved }: {
  collegeId?: string; run: PayrollRun; line: PayrollLine; actor: "OFFICE" | "ACCOUNTS" | "VIEWER"; editable: boolean; onClose: () => void; onSaved: () => void;
}) {
  const employed = line.auto.monthDays - line.auto.notEmployedDays;
  const [lopOn, setLopOn] = useState(!!line.lopOverride);
  const [lopDays, setLopDays] = useState(String(line.lopOverride?.days ?? line.auto.lop));
  const [lopReason, setLopReason] = useState(line.lopOverride?.reason ?? "");
  const [nc, setNc] = useState({ on: !!line.notCredited, reason: line.notCredited?.reason ?? "" });
  const [hold, setHold] = useState({ on: !!line.hold, reason: line.hold?.reason ?? "" });
  const [oneOffs, setOneOffs] = useState(line.oneOffs.map((o) => ({ ...o, amount: String(o.amount) })));
  const [manual, setManual] = useState<Record<string, string>>(Object.fromEntries(Object.entries(line.manual).map(([k, v]) => [k, String(v)])));
  const [itOn, setItOn] = useState(!!line.tdsOverride);
  const [itAmount, setItAmount] = useState(String(line.tdsOverride?.amount ?? line.tdsAuto ?? 0));
  const [itReason, setItReason] = useState(line.tdsOverride?.reason ?? "");
  const [advOn, setAdvOn] = useState(!!line.advanceOverride);
  const [advAmount, setAdvAmount] = useState(String(line.advanceOverride?.amount ?? line.advanceAuto ?? 0));
  const [advReason, setAdvReason] = useState(line.advanceOverride?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const manualDeds = run.settings.deductions.filter((d) => d.kind === "MANUAL" && d.active);
  const label = (id: string) => run.settings.deductions.find((d) => d.id === id)?.label ?? run.settings.earnings.find((e) => e.id === id)?.label ?? id;
  const isAccounts = actor === "ACCOUNTS";

  function buildEdit() {
    const edit: Record<string, unknown> = {};
    const lopNow = lopOn ? { days: Number(lopDays), reason: lopReason.trim() } : null;
    if (lopOn ? !line.lopOverride || line.lopOverride.days !== lopNow!.days || line.lopOverride.reason !== lopNow!.reason : !!line.lopOverride) edit.lopOverride = lopNow;
    for (const [key, v, cur] of [["notCredited", nc, line.notCredited], ["hold", hold, line.hold]] as const) {
      if (v.on ? !cur || cur.reason !== v.reason.trim() : !!cur) edit[key] = v.on ? { reason: v.reason.trim() } : null;
    }
    const oo = oneOffs.map((o) => ({ label: o.label.trim(), amount: Number(o.amount) || 0, ...(o.componentId ? { componentId: o.componentId } : {}) })).filter((o) => o.label || o.amount);
    if (JSON.stringify(oo) !== JSON.stringify(line.oneOffs)) edit.oneOffs = oo;
    const mm = Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => (v as number) > 0));
    if (JSON.stringify(mm) !== JSON.stringify(line.manual)) edit.manual = mm;
    if (isAccounts) {
      const now = itOn ? { amount: Number(itAmount) || 0, reason: itReason.trim() } : null;
      if (itOn ? !line.tdsOverride || line.tdsOverride.amount !== now!.amount || line.tdsOverride.reason !== now!.reason : !!line.tdsOverride) edit.tdsOverride = now;
    }
    if (isAccounts) {
      const now = advOn ? { amount: Number(advAmount) || 0, reason: advReason.trim() } : null;
      if (advOn ? !line.advanceOverride || line.advanceOverride.amount !== now!.amount || line.advanceOverride.reason !== now!.reason : !!line.advanceOverride) edit.advanceOverride = now;
    }
    return edit;
  }

  async function payslip() {
    try {
      const { payslip: p } = await payrollFetch<{ payslip: PayslipData }>(`/api/college/payroll/runs/${run.month}/payslip/${encodeURIComponent(line.employeeKey)}${collegeQs(collegeId)}`);
      await downloadPayslip(p);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to build the payslip" }); }
  }

  async function save() {
    const edit = buildEdit();
    if (Object.keys(edit).length === 0) { onClose(); return; }
    setBusy(true);
    try {
      await payrollFetch(`/api/college/payroll/runs/${run.month}/lines/${encodeURIComponent(line.employeeKey)}${collegeQs(collegeId)}`, { method: "PATCH", body: JSON.stringify({ rev: run.rev, edit }) });
      toast({ variant: "success", title: "Line updated" });
      onSaved();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }

  const r = line.result;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{line.name}</DialogTitle>
          <DialogDescription>{line.employeeCode || "No Emp Code"} · {line.designation} · {line.department} · {monthLabel(run.month)} · pay from {monthLabel(line.revisionFrom)}</DialogDescription>
        </DialogHeader>

        {line.issues.length > 0 && <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{line.issues.map((i) => <li key={i}>{i}</li>)}</ul>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <p className="font-medium">Pay days</p>
            <Row k="Days in the month" v={line.auto.monthDays} />
            {line.auto.notEmployedDays > 0 && <Row k={line.joiningDate?.startsWith(run.month) ? `Not yet joined (joined ${line.joiningDate})` : `After last working day (${line.lastWorkingDate})`} v={`- ${line.auto.notEmployedDays}`} />}
            <Row k="Loss of pay from leave" v={line.auto.leaveLop ? `- ${line.auto.leaveLop}` : "0"} />
            <Row k={`Absent per attendance${line.auto.absentDates.length ? ` (${line.auto.absentDates.map((d) => d.slice(8)).join(", ")})` : ""}`} v={line.auto.attendanceLop ? `- ${line.auto.attendanceLop}` : "0"} />
            {line.lopOverride && <Row k={`LOP set by ${line.lopOverride.byName}: ${line.lopOverride.reason}`} v={`${line.lopOverride.days} (auto ${line.auto.lop})`} />}
            {line.notCredited && <Row k={`Not credited: ${line.notCredited.reason}`} v="0 days" />}
            <Row k="Pay days" v={line.payDays} strong />
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Money</p>
            {run.settings.earnings.filter((e) => line.amounts[e.id]).map((e) => <Row key={e.id} k={`${e.label} (fixed ${rupees(line.amounts[e.id])})`} v={rupees(r.earned[e.id] ?? 0)} />)}
            {line.oneOffs.map((o, i) => <Row key={i} k={o.label} v={rupees(o.amount)} />)}
            <Row k="G. SAL" v={rupees(r.gross)} strong />
            {run.settings.deductions.filter((d) => (r.deductions[d.id] ?? 0) > 0).map((d) => <Row key={d.id} k={d.label} v={`- ${rupees(r.deductions[d.id])}`} />)}
            <Row k="Net salary" v={rupees(r.net)} strong />
            {line.exempt.length > 0 && <p className="text-xs text-muted-foreground">Not applied: {line.exempt.map(label).join(", ")}</p>}
          </div>
        </div>

        {editable && (
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={lopOn} onCheckedChange={(c) => setLopOn(!!c)} />Change the LOP days (automatic: {line.auto.lop})</label>
              {lopOn && (
                <div className="flex flex-wrap gap-3 pl-6">
                  <div className="space-y-1"><Label className="text-xs">LOP days (0-{employed}, halves allowed)</Label><Input inputMode="decimal" className="h-8 w-28" value={lopDays} onChange={(e) => setLopDays(e.target.value)} /></div>
                  <div className="min-w-[16rem] flex-1 space-y-1"><Label className="text-xs">Reason</Label><Input className="h-8" value={lopReason} onChange={(e) => setLopReason(e.target.value)} placeholder="12 Oct was approved permission" /></div>
                </div>
              )}
            </div>
            {([["Salary not credited (every column 0)", nc, setNc], ["Hold salary (stays in the register, left out of the bank file)", hold, setHold]] as const).map(([text, v, set]) => (
              <div key={text} className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={v.on} onCheckedChange={(c) => set({ ...v, on: !!c })} />{text}</label>
                {v.on && <Input className="ml-6 h-8 w-[calc(100%-1.5rem)]" value={v.reason} onChange={(e) => set({ ...v, reason: e.target.value })} placeholder="Reason" />}
              </div>
            ))}
            <div className="space-y-2">
              <div className="flex items-center justify-between"><p className="text-sm font-medium">One-off earnings (arrears, bonus)</p>
                <Button size="sm" variant="outline" onClick={() => setOneOffs([...oneOffs, { label: "", amount: "", componentId: undefined }])}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button></div>
              {oneOffs.map((o, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Name" className="h-8 w-56" value={o.label} placeholder="Arrears Oct 2026" onChange={(e) => setOneOffs(oneOffs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <Input aria-label="Amount" className="h-8 w-28" inputMode="numeric" value={o.amount} onChange={(e) => setOneOffs(oneOffs.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d]/g, "") } : x)))} />
                  <select aria-label="Counts as" className={`${selectClass} h-8`} value={o.componentId ?? ""} onChange={(e) => setOneOffs(oneOffs.map((x, j) => (j === i ? { ...x, componentId: e.target.value || undefined } : x)))}>
                    <option value="">Not a pay part (no PF / ESI)</option>
                    {run.settings.earnings.map((e) => <option key={e.id} value={e.id}>Arrears of {e.label}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setOneOffs(oneOffs.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              ))}
            </div>
            {manualDeds.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {manualDeds.map((d) => <div key={d.id} className="space-y-1"><Label className="text-xs">{d.label}</Label><Input className="h-8 w-28" inputMode="numeric" value={manual[d.id] ?? ""} onChange={(e) => setManual({ ...manual, [d.id]: e.target.value.replace(/[^\d]/g, "") })} /></div>)}
              </div>
            )}
          </div>
        )}

        {line.taxCalc && (
          <div className="space-y-2 border-t pt-3 text-sm">
            <p className="font-medium">Income tax</p>
            {line.taxCalc.rulesConfirmed ? (
              <p className="text-xs text-muted-foreground">{line.taxCalc.regime === "NEW" ? "New" : "Old"} regime · salary for the year Rs. {rupees(line.taxCalc.annualSalary)} · taxable Rs. {rupees(line.taxCalc.taxableIncome)} · tax Rs. {rupees(line.taxCalc.annualTax)} · deducted so far Rs. {rupees(line.taxCalc.deductedBefore)} · spread over {line.taxCalc.monthsLeft} month(s) = Rs. {rupees(line.tdsAuto ?? 0)}{line.tdsOverride ? ` · changed to Rs. ${rupees(line.tdsOverride.amount)} by ${line.tdsOverride.byName}: ${line.tdsOverride.reason}` : ""}</p>
            ) : <p className="text-xs text-amber-700 dark:text-amber-300">FY {line.taxCalc.fy} tax rules aren&apos;t confirmed by Accounts - no tax worked out.{line.tdsOverride ? ` Set by hand: Rs. ${rupees(line.tdsOverride.amount)}.` : ""}</p>}
            {editable && isAccounts && (
              <>
                <label className="flex items-center gap-2"><Checkbox checked={itOn} onCheckedChange={(c) => setItOn(!!c)} />Deduct a different IT this month</label>
                {itOn && (
                  <div className="flex flex-wrap gap-3 pl-6">
                    <div className="space-y-1"><Label className="text-xs">IT (Rs.)</Label><Input className="h-8 w-28" inputMode="numeric" value={itAmount} onChange={(e) => setItAmount(e.target.value.replace(/[^\d]/g, ""))} /></div>
                    <div className="min-w-[14rem] flex-1 space-y-1"><Label className="text-xs">Reason</Label><Input className="h-8" value={itReason} onChange={(e) => setItReason(e.target.value)} placeholder="employee asked for more" /></div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {(line.advanceBalance ?? 0) > 0 && (
          <div className="space-y-2 border-t pt-3 text-sm">
            <p className="font-medium">Salary advance</p>
            <p className="text-xs text-muted-foreground">Balance before this month Rs. {rupees(line.advanceBalance ?? 0)} · schedule this month Rs. {rupees(line.advanceAuto ?? 0)}{line.advanceOverride ? ` · changed to Rs. ${rupees(line.advanceOverride.amount)} by ${line.advanceOverride.byName}: ${line.advanceOverride.reason}` : ""}. Recorded against the advance when the month is released.</p>
            {editable && isAccounts && (
              <>
                <label className="flex items-center gap-2"><Checkbox checked={advOn} onCheckedChange={(c) => setAdvOn(!!c)} />Recover a different amount this month</label>
                {advOn && (
                  <div className="flex flex-wrap gap-3 pl-6">
                    <div className="space-y-1"><Label className="text-xs">Amount (up to {rupees(line.advanceBalance ?? 0)})</Label><Input className="h-8 w-28" inputMode="numeric" value={advAmount} onChange={(e) => setAdvAmount(e.target.value.replace(/[^\d]/g, ""))} /></div>
                    <div className="min-w-[14rem] flex-1 space-y-1"><Label className="text-xs">Reason</Label><Input className="h-8" value={advReason} onChange={(e) => setAdvReason(e.target.value)} /></div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {line.history.length > 0 && (
          <div className="space-y-1 border-t pt-3"><p className="text-sm font-medium">Changes</p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">{[...line.history].reverse().map((h, i) => <li key={i}>{new Date(h.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {h.byName}: {h.change}</li>)}</ul>
          </div>
        )}

        <DialogFooter>
          {actor !== "VIEWER" && <Button variant="ghost" className="mr-auto" onClick={payslip}>{run.status === "RELEASED" ? "Payslip (PDF)" : "Payslip preview (PDF)"}</Button>}
          <Button variant="outline" onClick={onClose}>Close</Button>
          {editable && <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v, strong }: { k: string; v: string | number; strong?: boolean }) {
  return <div className={`flex justify-between gap-3 ${strong ? "border-t pt-1 font-semibold" : ""}`}><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></div>;
}
