"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, Download, RefreshCw, Search, Send, Trash2, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import type { PayrollLine, PayrollRun, PayrollRunStatus, PayrollTotals } from "@/types/payroll";
import { PayrollLineDialog } from "./PayrollLineDialog";
import { MonthlyDeductionsDialog } from "./MonthlyDeductionsDialog";
import { downloadAnnualRegister, downloadBankFile, downloadRegister, downloadStatutory } from "./payrollExports";
import { collegeQs, monthLabel, payrollFetch, rupees, selectClass, thisMonth } from "./payrollClient";

// Monthly salaries. The College Office prepares a month (worked out from pay structures, leave and
// attendance), adjusts lines and submits; Accounts return it with remarks or approve, then release it
// (payment date + bank reference) - a released month is locked. Principal / VP read.

export const STATUS_LABEL: Record<PayrollRunStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "With Accounts", RETURNED: "Returned to Office", APPROVED: "Approved", RELEASING: "Releasing", RELEASED: "Released",
};
const STATUS_CLASS: Record<PayrollRunStatus, string> = {
  DRAFT: "bg-muted text-foreground", SUBMITTED: "bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200",
  RETURNED: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200", APPROVED: "bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200",
  RELEASING: "bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200", RELEASED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
};
export const StatusPill = ({ s }: { s: PayrollRunStatus }) => <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_CLASS[s])}>{STATUS_LABEL[s]}</span>;

type RunRow = { month: string; status: PayrollRunStatus; totals: PayrollTotals; excludedCount: number; release: PayrollRun["release"] | null; returnRemarks: string | null };

export function MonthlyRuns({ collegeId }: { collegeId?: string }) {
  const [list, setList] = useState<{ runs: RunRow[]; role: string } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [prepMonth, setPrepMonth] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    payrollFetch<{ runs: RunRow[]; role: string }>(`/api/college/payroll/runs${collegeQs(collegeId)}`).then((d) => { setList(d); setError(""); }).catch((e: Error) => setError(e.message));
  }, [collegeId]);
  useEffect(load, [load]);

  async function prepare() {
    setBusy(true);
    try {
      await payrollFetch(`/api/college/payroll/runs${collegeQs(collegeId)}`, { method: "POST", body: JSON.stringify({ month: prepMonth }) });
      toast({ variant: "success", title: `${monthLabel(prepMonth)} prepared` });
      setOpen(prepMonth); load();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to prepare" }); }
    finally { setBusy(false); }
  }

  async function annual(fy: string) {
    try {
      const r = await payrollFetch<{ rows: Parameters<typeof downloadAnnualRegister>[1] }>(`/api/college/payroll/reports/annual${collegeQs(collegeId, { fy })}`);
      if (r.rows.length === 0) { toast({ title: `Nothing released in FY ${fy} yet` }); return; }
      const name = (await payrollFetch<{ collegeName?: string }>(`/api/college/payroll/runs/${r.rows[0].month}${collegeQs(collegeId)}`).catch(() => ({ collegeName: "College" }))).collegeName ?? "College";
      await downloadAnnualRegister(fy, r.rows, name);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to build the register" }); }
  }

  if (open) return <RunView collegeId={collegeId} month={open} onBack={() => { setOpen(null); load(); }} />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!list) return <div className="h-40 animate-pulse rounded-2xl bg-muted/40" />;
  const isOffice = list.role === "COLLEGE_OFFICE" || list.role === "SUPER_ADMIN";

  return (
    <div className="space-y-4">
      {isOffice && (
        <Card className="rounded-2xl"><CardContent className="flex flex-wrap items-end gap-3 p-5">
          <div className="space-y-1.5"><Label htmlFor="mr-month">Prepare salaries for</Label><Input id="mr-month" type="month" className="w-44" value={prepMonth} onChange={(e) => e.target.value && setPrepMonth(e.target.value)} /></div>
          <Button onClick={prepare} disabled={busy || list.runs.some((r) => r.month === prepMonth)}>{busy ? "Working..." : "Prepare month"}</Button>
          <p className="text-xs text-muted-foreground">Pay days come from joining / relieving dates, the leave register&apos;s loss of pay and absences marked in attendance. You can adjust each line before submitting to Accounts.</p>
        </CardContent></Card>
      )}
      {list.role !== "PRINCIPAL" && list.role !== "VICE_PRINCIPAL" && list.runs.some((r) => r.status === "RELEASED") && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Annual salary register (released months):</span>
          {[...new Set(list.runs.filter((r) => r.status === "RELEASED").map((r) => { const y = Number(r.month.slice(0, 4)), m = Number(r.month.slice(5)); const st = m >= 4 ? y : y - 1; return `${st}-${String((st + 1) % 100).padStart(2, "0")}`; }))].map((fy) => (
            <Button key={fy} size="sm" variant="outline" onClick={() => annual(fy)}><Download className="mr-1 h-3.5 w-3.5" />FY {fy}</Button>
          ))}
        </div>
      )}
      {list.runs.length === 0 ? <p className="text-sm text-muted-foreground">No months prepared yet.</p> : (
        <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">Month</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">People</th><th className="px-3 py-2 text-right">G. SAL</th><th className="px-3 py-2 text-right">Deductions</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>{list.runs.map((r) => (
              <tr key={r.month} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => setOpen(r.month)}>
                <td className="px-3 py-2 font-medium">{monthLabel(r.month)}</td>
                <td className="px-3 py-2"><StatusPill s={r.status} />{r.status === "RETURNED" && r.returnRemarks && <div className="mt-1 max-w-xs truncate text-xs text-muted-foreground">{r.returnRemarks}</div>}{r.release && <div className="mt-1 text-xs text-muted-foreground">Paid {r.release.paidOn} · {r.release.reference}</div>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.totals.count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rupees(r.totals.gross)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rupees(r.totals.totalDeductions)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{rupees(r.totals.net)}</td>
                <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost">Open</Button></td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent></Card>
      )}
    </div>
  );
}

type RunData = { run: PayrollRun; lines: PayrollLine[]; actor: "OFFICE" | "ACCOUNTS" | "VIEWER"; superAdmin: boolean; collegeName: string };

function RunView({ collegeId, month, onBack }: { collegeId?: string; month: string; onBack: () => void }) {
  const [d, setD] = useState<RunData | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"" | "TEACHING" | "NON_TEACHING" | "ISSUES" | "CHANGED">("");
  const [line, setLine] = useState<PayrollLine | null>(null);
  const [dialog, setDialog] = useState<"RETURN" | "RELEASE" | null>(null);
  const [deductionsOpen, setDeductionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = `/api/college/payroll/runs/${month}${collegeQs(collegeId)}`;
  const load = useCallback(() => {
    payrollFetch<RunData>(url).then((x) => { setD(x); setError(""); }).catch((e: Error) => setError(e.message));
  }, [url]);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (d?.lines ?? []).filter((l) =>
      (!filter || (filter === "ISSUES" ? l.issues.length > 0 : filter === "CHANGED" ? !!(l.lopOverride || l.hold || l.notCredited || l.oneOffs.length || Object.keys(l.manual).length) : l.section === filter)) &&
      (!s || `${l.employeeCode} ${l.name} ${l.department}`.toLowerCase().includes(s)));
  }, [d, q, filter]);

  if (error) return <div className="space-y-3"><Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-1.5 h-4 w-4" />All months</Button><p className="text-sm text-destructive">{error}</p></div>;
  if (!d) return <div className="h-60 animate-pulse rounded-2xl bg-muted/40" />;
  const { run, actor, superAdmin } = d;
  const office = actor === "OFFICE" || superAdmin;
  const accounts = actor === "ACCOUNTS";
  const editable = (office && (run.status === "DRAFT" || run.status === "RETURNED")) || (accounts && ["DRAFT", "RETURNED", "SUBMITTED"].includes(run.status));
  const earnings = run.settings.earnings.filter((e) => e.active || run.totals.earned[e.id]);
  const deductions = run.settings.deductions.filter((x) => x.active || run.totals.deductions[x.id]);
  const issues = d.lines.filter((l) => l.issues.length > 0).length;

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      await payrollFetch(url, { method: "POST", body: JSON.stringify({ action, rev: run.rev, ...extra }) });
      toast({ variant: "success", title: { SUBMIT: "Sent to Accounts", RETURN: "Returned to the College Office", APPROVE: "Approved", REOPEN: "Reopened", RELEASE: "Released - the month is locked" }[action] ?? "Done" });
      setDialog(null); load();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to do that" }); }
    finally { setBusy(false); }
  }
  async function recalc() {
    setBusy(true);
    try {
      const r = await payrollFetch<{ changed: number; removed: number; added: number }>(`/api/college/payroll/runs/${month}/recalculate${collegeQs(collegeId)}`, { method: "POST", body: JSON.stringify({ rev: run.rev }) });
      toast({ variant: "success", title: `Recalculated: ${r.changed} changed, ${r.added} added, ${r.removed} removed` });
      load();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to recalculate" }); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Remove the ${monthLabel(month)} draft? You can prepare it again.`)) return;
    try { await payrollFetch(url, { method: "DELETE" }); onBack(); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to remove" }); }
  }
  async function statutory() {
    try {
      const problems = await downloadStatutory(run, d!.lines, d!.collegeName);
      if (problems.length) toast({ variant: "destructive", title: "Check before filing", description: problems.join(" · ") });
    } catch { toast({ variant: "destructive", title: "Unable to build the files" }); }
  }
  function bank() {
    const missing = downloadBankFile(run, d!.lines);
    if (missing.length) toast({ variant: "destructive", title: `${missing.length} left out - no bank account / IFSC`, description: missing.slice(0, 5).join(", ") });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-1.5 h-4 w-4" />All months</Button>
        <h2 className="text-xl font-semibold">{monthLabel(month)}</h2>
        <StatusPill s={run.status} />
        <span className="text-xs text-muted-foreground">{run.monthDays} days · worked out {new Date(run.calculatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
      </div>

      {run.taxRulesConfirmed === false && run.settings.deductions.some((x) => x.kind === "INCOME_TAX" && x.active) && run.status !== "RELEASED" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Income tax isn&apos;t worked out: Accounts haven&apos;t confirmed this financial year&apos;s tax rules (Payroll &gt; Income tax). After they do, Recalculate.</p>
      )}
      {run.status === "RETURNED" && run.returnRemarks && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><span className="font-semibold">Accounts returned it: </span>{run.returnRemarks}</p>}
      {run.release && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">Released - paid on {run.release.paidOn}, reference {run.release.reference} ({run.release.byName}). This month is locked; corrections go into a later month as arrears or deductions.</p>}

      <div className="flex flex-wrap gap-2">
        {editable && <Button variant="outline" onClick={recalc} disabled={busy}><RefreshCw className="mr-1.5 h-4 w-4" />Recalculate</Button>}
        {editable && <Button variant="outline" onClick={() => setDeductionsOpen(true)} disabled={busy}><Upload className="mr-1.5 h-4 w-4" />Monthly deductions</Button>}
        {office && (run.status === "DRAFT" || run.status === "RETURNED") && <Button onClick={() => act("SUBMIT")} disabled={busy || run.totals.shortfalls > 0}><Send className="mr-1.5 h-4 w-4" />Submit to Accounts</Button>}
        {office && run.status === "DRAFT" && <Button variant="ghost" className="text-destructive" onClick={remove}><Trash2 className="mr-1.5 h-4 w-4" />Remove draft</Button>}
        {accounts && run.status === "SUBMITTED" && <Button onClick={() => act("APPROVE")} disabled={busy || run.totals.shortfalls > 0}><CheckCircle2 className="mr-1.5 h-4 w-4" />Approve</Button>}
        {accounts && (run.status === "SUBMITTED" || run.status === "APPROVED") && <Button variant="outline" onClick={() => setDialog("RETURN")} disabled={busy}><Undo2 className="mr-1.5 h-4 w-4" />Return to Office</Button>}
        {accounts && run.status === "APPROVED" && <Button variant="outline" onClick={() => act("REOPEN")} disabled={busy}>Reopen</Button>}
        {accounts && (run.status === "APPROVED" || run.status === "RELEASING") && <Button onClick={() => setDialog("RELEASE")} disabled={busy}><Banknote className="mr-1.5 h-4 w-4" />{run.status === "RELEASING" ? "Finish release" : "Release"}</Button>}
        <span className="flex-1" />
        <Button variant="outline" onClick={() => downloadRegister(run, d.lines, d.collegeName)}><Download className="mr-1.5 h-4 w-4" />Register (Excel)</Button>
        {actor !== "VIEWER" && <Button variant="outline" onClick={bank}><Download className="mr-1.5 h-4 w-4" />Bank file</Button>}
        {actor !== "VIEWER" && <Button variant="outline" onClick={statutory}><Download className="mr-1.5 h-4 w-4" />PF / ESI / PT / TDS</Button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["People", String(run.totals.count)], ["G. SAL", rupees(run.totals.gross)], ["Deductions", rupees(run.totals.totalDeductions)], ["Net", rupees(run.totals.net)]].map(([k, v]) => (
          <Card key={k} className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="text-xl font-semibold tabular-nums">{v}</p></CardContent></Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {(["TEACHING", "NON_TEACHING"] as const).map((s) => run.totals.sections[s].count > 0 && <span key={s} className="rounded-full bg-muted px-3 py-1">{s === "TEACHING" ? "Teaching" : "Non-teaching"}: {run.totals.sections[s].count} · net {rupees(run.totals.sections[s].net)}</span>)}
        {run.totals.held > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{run.totals.held} on hold · {rupees(run.totals.heldNet)}</span>}
        {run.totals.notCredited > 0 && <span className="rounded-full bg-muted px-3 py-1">{run.totals.notCredited} not credited</span>}
        {run.totals.shortfalls > 0 && <span className="rounded-full bg-red-100 px-3 py-1 text-red-900 dark:bg-red-950/50 dark:text-red-200">{run.totals.shortfalls} with deductions above salary - fix before submitting</span>}
      </div>

      {run.excluded.length > 0 && (
        <details className="rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium"><AlertTriangle className="mr-1 inline h-4 w-4 text-amber-600" />{run.excluded.length} not in this month</summary>
          <ul className="mt-2 space-y-1 text-xs">{run.excluded.map((x) => <li key={x.employeeKey}><span className="font-mono">{x.employeeCode || "-"}</span> {x.name} - {x.reason}</li>)}</ul>
          <p className="mt-2 text-xs text-muted-foreground">Accounts set pay in Pay structures, then Recalculate.</p>
        </details>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[14rem] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search" className="pl-8" placeholder="Emp Code, name, department" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Show" className={selectClass} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="">Everyone</option><option value="TEACHING">Teaching</option><option value="NON_TEACHING">Non-teaching</option>
          <option value="ISSUES">Needs a look ({issues})</option><option value="CHANGED">Adjusted by hand</option>
        </select>
      </div>

      <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[70rem] text-xs">
          <thead className="bg-muted/50 text-left uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-2">Emp Code</th><th className="px-2 py-2">Name</th><th className="px-2 py-2 text-right">Pay Days</th><th className="px-2 py-2 text-right">Gross_Actual</th>
              {earnings.map((e) => <th key={e.id} className="px-2 py-2 text-right">{e.label}</th>)}
              <th className="px-2 py-2 text-right">Other</th><th className="px-2 py-2 text-right">G. SAL</th>
              {deductions.map((x) => <th key={x.id} className="px-2 py-2 text-right">{x.label}</th>)}
              <th className="px-2 py-2 text-right">Total Ded</th><th className="px-2 py-2 text-right">Net</th>
            </tr>
          </thead>
          <tbody>{rows.map((l) => (
            <tr key={l.employeeKey} className={cn("cursor-pointer border-t hover:bg-muted/30", (l.hold || l.notCredited) && "text-muted-foreground")} onClick={() => setLine(l)}>
              <td className="whitespace-nowrap px-2 py-1.5 font-mono">{l.employeeCode || "-"}</td>
              <td className="px-2 py-1.5"><span className="font-medium text-foreground">{l.name}</span> <span className="text-muted-foreground">{l.department}</span>
                {l.hold && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">hold</span>}
                {l.notCredited && <span className="ml-1 rounded bg-muted px-1">not credited</span>}
                {l.issues.length > 0 && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-600" aria-label={l.issues.join("; ")} />}
              </td>
              <td className={cn("px-2 py-1.5 text-right tabular-nums", l.payDays !== l.auto.monthDays && "font-semibold text-foreground")}>{l.payDays}{l.lopOverride ? "*" : ""}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{rupees(l.result.grossActual)}</td>
              {earnings.map((e) => <td key={e.id} className="px-2 py-1.5 text-right tabular-nums">{rupees(l.result.earned[e.id] ?? 0)}</td>)}
              <td className="px-2 py-1.5 text-right tabular-nums">{l.result.oneOffTotal ? rupees(l.result.oneOffTotal) : ""}</td>
              <td className="px-2 py-1.5 text-right font-medium tabular-nums">{rupees(l.result.gross)}</td>
              {deductions.map((x) => <td key={x.id} className="px-2 py-1.5 text-right tabular-nums">{rupees(l.result.deductions[x.id] ?? 0)}</td>)}
              <td className="px-2 py-1.5 text-right tabular-nums">{rupees(l.result.totalDeductions)}</td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{rupees(l.result.net)}</td>
            </tr>
          ))}</tbody>
          <tfoot className="border-t-2 bg-muted/30 font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={3}>Report total ({run.totals.count})</td>
              <td className="px-2 py-2 text-right tabular-nums">{rupees(run.totals.grossActual)}</td>
              {earnings.map((e) => <td key={e.id} className="px-2 py-2 text-right tabular-nums">{rupees(run.totals.earned[e.id] ?? 0)}</td>)}
              <td className="px-2 py-2 text-right tabular-nums">{run.totals.oneOffs ? rupees(run.totals.oneOffs) : ""}</td>
              <td className="px-2 py-2 text-right tabular-nums">{rupees(run.totals.gross)}</td>
              {deductions.map((x) => <td key={x.id} className="px-2 py-2 text-right tabular-nums">{rupees(run.totals.deductions[x.id] ?? 0)}</td>)}
              <td className="px-2 py-2 text-right tabular-nums">{rupees(run.totals.totalDeductions)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{rupees(run.totals.net)}</td>
            </tr>
          </tfoot>
        </table>
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">* pay days changed by the College Office. Click a row for how it was worked out{editable ? " and to adjust it" : ""}.</p>

      <details className="rounded-md border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">History</summary>
        <ul className="mt-2 space-y-1 text-xs">{[...run.history].reverse().map((h, i) => (
          <li key={i}><span className="font-medium">{h.action.toLowerCase().replace(/_/g, " ")}</span> · {h.byName} · {new Date(h.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{h.remarks ? ` - ${h.remarks}` : ""}</li>
        ))}</ul>
      </details>

      {deductionsOpen && <MonthlyDeductionsDialog collegeId={collegeId} run={run} lines={d.lines} onClose={() => setDeductionsOpen(false)} onDone={() => { setDeductionsOpen(false); load(); }} />}
      {line && <PayrollLineDialog collegeId={collegeId} run={run} line={line} actor={actor} editable={editable} onClose={() => setLine(null)} onSaved={() => { setLine(null); load(); }} />}
      {dialog && <MoveDialog kind={dialog} month={month} busy={busy} onClose={() => setDialog(null)} onConfirm={(extra) => act(dialog, extra)} />}
    </div>
  );
}

function MoveDialog({ kind, month, busy, onClose, onConfirm }: { kind: "RETURN" | "RELEASE"; month: string; busy: boolean; onClose: () => void; onConfirm: (extra: Record<string, unknown>) => void }) {
  const [remarks, setRemarks] = useState("");
  const [paidOn, setPaidOn] = useState(() => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "RETURN" ? "Return to the College Office" : `Release ${monthLabel(month)} salaries`}</DialogTitle>
          <DialogDescription>{kind === "RETURN" ? "Say what needs fixing - the Office sees it on the month." : "Once released the month is locked for good: it can't be changed, returned or recalculated."}</DialogDescription>
        </DialogHeader>
        {kind === "RETURN" ? (
          <div className="space-y-1.5"><Label htmlFor="mv-rem">Remarks</Label><Textarea id="mv-rem" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="mv-date">Paid on</Label><Input id="mv-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="mv-ref">Bank reference</Label><Input id="mv-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bulk transfer / UTR reference" /></div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || (kind === "RETURN" ? !remarks.trim() : !paidOn || !reference.trim())} onClick={() => onConfirm(kind === "RETURN" ? { remarks } : { paidOn, reference })}>{kind === "RETURN" ? "Return" : "Release"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
