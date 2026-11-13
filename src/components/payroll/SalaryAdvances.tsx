"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { parseCSVWithRowNumbers, parseExcelFileWithRowNumbers, readFileAsText } from "@/lib/utils/csv";
import type { AdvanceImportPlanRow } from "@/lib/payroll/advance";
import type { SalaryAdvance } from "@/types/payroll";
import { collegeQs, monthLabel, payrollFetch, rupees, selectClass, thisMonth } from "./payrollClient";

// Salary advances: Accounts give or record an advance with its monthly recovery (an amount, with its %
// shown, or a %), pause / resume / change it, or close it early with a reason. Each month's run deducts
// the instalment (the last month only the balance); the recovery is recorded when that month is
// released. The College Office reads.

type Adv = SalaryAdvance & { recovered: number; balance: number; monthsLeft: number };
type Emp = { employeeKey: string; employeeCode: string; name: string; department: string };
const STATUS: Record<SalaryAdvance["status"], [string, string]> = {
  ACTIVE: ["Recovering", "bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200"],
  PAUSED: ["Paused", "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"],
  CLOSED: ["Closed", "bg-muted text-muted-foreground"],
};

export function SalaryAdvances({ collegeId }: { collegeId?: string }) {
  const [d, setD] = useState<{ advances: Adv[]; employees: Emp[]; canEdit: boolean } | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"OPEN" | "ALL">("OPEN");
  const [editing, setEditing] = useState<Adv | "NEW" | null>(null);
  const [importing, setImporting] = useState(false);
  const load = useCallback(() => {
    payrollFetch<{ advances: Adv[]; employees: Emp[]; canEdit: boolean }>(`/api/college/payroll/advances${collegeQs(collegeId)}`).then((x) => { setD(x); setError(""); }).catch((e: Error) => setError(e.message));
  }, [collegeId]);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (d?.advances ?? []).filter((a) => (show === "ALL" || a.status !== "CLOSED") && (!s || `${a.employeeCode} ${a.name}`.toLowerCase().includes(s)));
  }, [d, q, show]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!d) return <div className="h-40 animate-pulse rounded-2xl bg-muted/40" />;
  const open = d.advances.filter((a) => a.status !== "CLOSED");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[14rem] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search" className="pl-8" placeholder="Emp Code or name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Show" className={selectClass} value={show} onChange={(e) => setShow(e.target.value as typeof show)}><option value="OPEN">Running</option><option value="ALL">All, with closed</option></select>
        {d.canEdit && <Button variant="outline" onClick={() => setImporting(true)}><Upload className="mr-1.5 h-4 w-4" />Import running advances</Button>}
        {d.canEdit && <Button onClick={() => setEditing("NEW")}><Plus className="mr-1.5 h-4 w-4" />New advance</Button>}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-muted px-3 py-1">{open.length} running · balance Rs. {rupees(open.reduce((s, a) => s + a.balance, 0))}</span>
        <span className="rounded-full bg-muted px-3 py-1">Next month&apos;s recovery up to Rs. {rupees(open.filter((a) => a.status === "ACTIVE").reduce((s, a) => s + Math.min(a.instalment, a.balance), 0))}</span>
      </div>
      <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">Person</th><th className="px-3 py-2 text-right">Advance</th><th className="px-3 py-2 text-right">Monthly</th><th className="px-3 py-2">From</th><th className="px-3 py-2 text-right">Recovered</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id} className="border-t">
              <td className="px-3 py-2"><div className="font-medium">{a.name}</div><div className="font-mono text-xs text-muted-foreground">{a.employeeCode}</div></td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(a.amount)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(a.instalment)}<div className="text-xs text-muted-foreground">{a.recoveryPercent}%</div></td>
              <td className="px-3 py-2">{monthLabel(a.startMonth)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rupees(a.recovered)}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{rupees(a.balance)}{a.monthsLeft > 0 && <div className="text-xs font-normal text-muted-foreground">{a.monthsLeft} month{a.monthsLeft === 1 ? "" : "s"} left</div>}</td>
              <td className="px-3 py-2"><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS[a.status][1])}>{STATUS[a.status][0]}</span>{a.closedNote && <div className="mt-1 max-w-[14rem] text-xs text-muted-foreground">{a.closedNote}</div>}</td>
              <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(a)}>{d.canEdit && a.status !== "CLOSED" ? "Manage" : "Details"}</Button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No advances.</td></tr>}</tbody>
        </table>
      </CardContent></Card>
      {editing && <AdvanceDialog collegeId={collegeId} advance={editing === "NEW" ? null : editing} employees={d.employees} canEdit={d.canEdit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {importing && <AdvanceImport collegeId={collegeId} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </div>
  );
}

function AdvanceDialog({ collegeId, advance, employees, canEdit, onClose, onSaved }: { collegeId?: string; advance: Adv | null; employees: Emp[]; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const started = !!advance && Object.keys(advance.recoveries ?? {}).length > 0;
  const [who, setWho] = useState("");
  const [f, setF] = useState({
    amount: String(advance?.amount ?? ""), recoveredBefore: String(advance?.recoveredBefore ?? 0), mode: "AMOUNT" as "AMOUNT" | "PERCENT",
    instalment: String(advance?.instalment ?? ""), percent: String(advance?.recoveryPercent ?? ""), startMonth: advance?.startMonth ?? thisMonth(),
    givenOn: advance?.givenOn ?? "", note: advance?.note ?? "",
  });
  const [closeReason, setCloseReason] = useState("");
  const [busy, setBusy] = useState(false);
  const live = canEdit && (!advance || advance.status !== "CLOSED");
  const amount = Number(f.amount) || 0;
  const inst = f.mode === "AMOUNT" ? Number(f.instalment) || 0 : Math.floor((amount * (Number(f.percent) || 0)) / 100 + 0.5);
  const balance = amount - (Number(f.recoveredBefore) || 0) - (advance ? advance.recovered - advance.recoveredBefore : 0);
  const matches = employees.filter((e) => who.trim() && `${e.employeeCode} ${e.name}`.toLowerCase().includes(who.trim().toLowerCase())).slice(0, 8);
  const [picked, setPicked] = useState<Emp | null>(null);

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const url = advance ? `/api/college/payroll/advances/${advance.id}${collegeQs(collegeId)}` : `/api/college/payroll/advances${collegeQs(collegeId)}`;
      await payrollFetch(url, { method: advance ? "PATCH" : "POST", body: JSON.stringify(advance ? { rev: advance.rev, ...body } : body) });
      toast({ variant: "success", title: done }); onSaved();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }
  const values = () => ({
    ...(started ? {} : { amount: Number(f.amount), recoveredBefore: Number(f.recoveredBefore) || 0, startMonth: f.startMonth }),
    ...(f.mode === "AMOUNT" ? { instalment: Number(f.instalment) } : { recoveryPercent: Number(f.percent) }),
    givenOn: f.givenOn || undefined, note: f.note,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{advance ? `${advance.name} - advance` : "New salary advance"}</DialogTitle>
          <DialogDescription>{advance ? `${advance.employeeCode} · given Rs. ${rupees(advance.amount)}${advance.givenOn ? ` on ${advance.givenOn}` : ""} · balance Rs. ${rupees(advance.balance)}` : "Recovered from salary each month; the last month takes only what is left."}</DialogDescription>
        </DialogHeader>
        {!advance && (
          <div className="space-y-1.5"><Label htmlFor="ad-who">Person</Label>
            {picked ? <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"><span>{picked.name} <span className="font-mono text-xs text-muted-foreground">{picked.employeeCode}</span> · {picked.department}</span><Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Change</Button></div> : (
              <>
                <Input id="ad-who" placeholder="Type Emp Code or name" value={who} onChange={(e) => setWho(e.target.value)} />
                {matches.length > 0 && <ul className="rounded-md border text-sm">{matches.map((e) => <li key={e.employeeKey}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-muted" onClick={() => { setPicked(e); setWho(""); }}>{e.name} <span className="font-mono text-xs text-muted-foreground">{e.employeeCode}</span> · {e.department}</button></li>)}</ul>}
              </>
            )}
          </div>
        )}
        {live && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label htmlFor="ad-amt">Advance (Rs.)</Label><Input id="ad-amt" inputMode="numeric" disabled={started} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, "") })} /></div>
              <div className="space-y-1"><Label htmlFor="ad-rb">Recovered before (Rs.)</Label><Input id="ad-rb" inputMode="numeric" disabled={started} value={f.recoveredBefore} onChange={(e) => setF({ ...f, recoveredBefore: e.target.value.replace(/[^\d]/g, "") })} /></div>
              <div className="space-y-1"><Label htmlFor="ad-from">Recover from</Label><Input id="ad-from" type="month" disabled={started} value={f.startMonth} onChange={(e) => e.target.value && setF({ ...f, startMonth: e.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">&quot;Recovered before&quot; is only for an advance already running before payroll moved into the app.{started ? " The amount and first month can't change once a month has recovered from it." : ""}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label htmlFor="ad-mode">Monthly recovery as</Label>
                <select id="ad-mode" className={selectClass} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as typeof f.mode })}><option value="AMOUNT">An amount</option><option value="PERCENT">A % of the advance</option></select>
              </div>
              {f.mode === "AMOUNT"
                ? <div className="space-y-1"><Label htmlFor="ad-inst">Rs. a month</Label><Input id="ad-inst" inputMode="numeric" className="w-32" value={f.instalment} onChange={(e) => setF({ ...f, instalment: e.target.value.replace(/[^\d]/g, "") })} /></div>
                : <div className="space-y-1"><Label htmlFor="ad-pct">% a month</Label><Input id="ad-pct" inputMode="decimal" className="w-28" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value.replace(/[^\d.]/g, "") })} /></div>}
              {amount > 0 && inst > 0 && <p className="pb-2 text-sm text-muted-foreground">Rs. {rupees(inst)} a month ({Math.round((inst / amount) * 100000) / 1000}%) · about {Math.ceil(Math.max(balance, 0) / inst)} month(s)</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="ad-on">Given on (optional)</Label><Input id="ad-on" type="date" value={f.givenOn} onChange={(e) => setF({ ...f, givenOn: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="ad-note">Note (optional)</Label><Input id="ad-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">A change applies to months not yet released; an open month picks it up when recalculated.</p>
          </div>
        )}
        {advance && (
          <div className="space-y-2 border-t pt-3 text-sm">
            <p className="font-medium">Recoveries</p>
            {advance.recoveredBefore > 0 && <p className="text-xs">Before the app: Rs. {rupees(advance.recoveredBefore)}</p>}
            {Object.keys(advance.recoveries ?? {}).length === 0 ? <p className="text-xs text-muted-foreground">None released yet.</p> : (
              <ul className="text-xs">{Object.entries(advance.recoveries).sort().map(([m, v]) => <li key={m}>{monthLabel(m)}: Rs. {rupees(v)}</li>)}</ul>
            )}
            <details><summary className="cursor-pointer text-xs font-medium">History</summary>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{[...(advance.history ?? [])].reverse().map((h, i) => <li key={i}>{new Date(h.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {h.byName}: {h.change}</li>)}</ul>
            </details>
          </div>
        )}
        {advance && live && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            {advance.status === "ACTIVE" && <Button variant="outline" disabled={busy} onClick={() => send({ action: "PAUSE" }, "Recovery paused")}>Pause recovery</Button>}
            {advance.status === "PAUSED" && <Button variant="outline" disabled={busy} onClick={() => send({ action: "RESUME" }, "Recovery resumed")}>Resume recovery</Button>}
            <Input aria-label="Reason for closing" className="h-9 min-w-[12rem] flex-1" placeholder="Reason to close early (for example paid back in cash)" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
            <Button variant="ghost" className="text-destructive" disabled={busy || !closeReason.trim()} onClick={() => send({ action: "CLOSE", reason: closeReason }, "Advance closed")}>Close</Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{live ? "Cancel" : "Close"}</Button>
          {live && <Button disabled={busy || (!advance && !picked) || !amount || !inst} onClick={() => send(advance ? { action: "EDIT", ...values() } : { employeeKey: picked!.employeeKey, ...values() }, advance ? "Advance updated" : "Advance added")}>{advance ? "Save changes" : "Add advance"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ImportPlan = { rows: AdvanceImportPlanRow[]; unknownColumns: string[]; errors: number; applied: number };
const HEADERS = ["Emp Code", "Name", "Advance amount", "Recovered so far", "Monthly recovery", "Monthly %", "First month", "Note"];

function AdvanceImport({ collegeId, onClose, onDone }: { collegeId?: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ headers: string[]; rows: { row: number; code: string; values: Record<string, string> }[] } | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/college/payroll/advances/import${collegeQs(collegeId)}`;

  async function template() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Advances");
    ws.addRow(HEADERS).font = { bold: true };
    ws.columns = HEADERS.map((h) => ({ width: Math.max(h.length + 4, 14), style: { numFmt: "@" } }));
    const help = wb.addWorksheet("Instructions");
    [["Column", "What to enter"], ["Emp Code", "Required - finds the person."], ["Advance amount", "The full advance given."],
      ["Recovered so far", "What was already recovered before payroll moved into the app (blank = 0)."],
      ["Monthly recovery", "Rupees a month. Or leave it blank and give Monthly % instead."], ["Monthly %", "% of the advance a month (decimals allowed)."],
      ["First month", "First month to recover in the app, e.g. Nov 2026."], ["Note", "Optional."], [],
      ["Example", "20,000 given, 6,667 already recovered, 6,667 a month from Nov 2026 -> Advance amount 20000, Recovered so far 6667, Monthly recovery 6667, First month Nov 2026."]].forEach((r) => help.addRow(r));
    help.columns = [{ width: 18 }, { width: 90 }];
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "salary_advances.xlsx"; a.click(); URL.revokeObjectURL(a.href);
  }
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPlan(null); setFile(null);
    try {
      const lower = f.name.toLowerCase();
      if (lower.endsWith(".xls")) throw new Error("Save the file as .xlsx or .csv first");
      const parsed = lower.endsWith(".csv") ? parseCSVWithRowNumbers(await readFileAsText(f)) : await parseExcelFileWithRowNumbers(f, `/api/college/payroll/parse-excel${collegeQs(collegeId)}`);
      const headers = (parsed.rows[0] ?? []).map((h) => String(h ?? "").trim());
      const codeAt = headers.findIndex((h) => ["EMPCODE", "EMPLOYEECODE", "EMPLOYEEID"].includes(h.toUpperCase().replace(/[^A-Z]/g, "")));
      if (codeAt < 0) throw new Error('The file needs an "Emp Code" column');
      const rows = parsed.rows.slice(1).map((r, i) => ({ row: parsed.rowNumbers[i + 1] ?? i + 2, code: String(r[codeAt] ?? "").trim(), values: Object.fromEntries(headers.map((h, j) => [h, String(r[j] ?? "").trim()])) }))
        .filter((r) => Object.values(r.values).some(Boolean));
      if (rows.length === 0) throw new Error("No rows under the header");
      setFile({ headers, rows });
      await run("preview", { headers, rows });
    } catch (err) { toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to read the file" }); }
  }
  async function run(mode: "preview" | "apply", body: { headers: string[]; rows: { row: number; code: string; values: Record<string, string> }[] } | null = file) {
    if (!body) return;
    setBusy(true);
    try {
      const d = await payrollFetch<ImportPlan>(url, { method: "POST", body: JSON.stringify({ mode, ...body }) });
      setPlan(d);
      if (mode === "apply") { toast({ variant: "success", title: `${d.applied} advances added` }); onDone(); }
    } catch (err) {
      const data = (err as { data?: ImportPlan }).data;
      if (data?.rows) setPlan(data);
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to import" });
    } finally { setBusy(false); }
  }
  const bad = plan?.rows.filter((r) => r.status === "ERROR") ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import running advances</DialogTitle>
          <DialogDescription>For advances already being recovered before payroll was moved into the application. Each row adds a new advance, so upload a file only once.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={template}><Download className="mr-1.5 h-4 w-4" />Template</Button>
          <Button variant="outline" asChild><label className="cursor-pointer"><Upload className="mr-1.5 h-4 w-4" />Upload file<input type="file" accept=".xlsx,.csv" className="sr-only" onChange={pick} /></label></Button>
        </div>
        {plan && (
          <div className="space-y-2 text-sm">
            <p>{plan.rows.length - bad.length} ready · {bad.length} with problems</p>
            {plan.unknownColumns.length > 0 && <p className="text-destructive">Columns this import doesn&apos;t know: {plan.unknownColumns.join(", ")}</p>}
            <div className="max-h-72 overflow-auto rounded-md border"><table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left"><tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Emp Code</th><th className="px-2 py-1">Person / problem</th><th className="px-2 py-1 text-right">Advance</th><th className="px-2 py-1 text-right">Balance</th><th className="px-2 py-1 text-right">Monthly</th><th className="px-2 py-1">From</th></tr></thead>
              <tbody>{[...bad, ...plan.rows.filter((r) => r.status === "OK")].map((r) => (
                <tr key={r.row} className="border-t">
                  <td className="px-2 py-1">{r.row}</td><td className="px-2 py-1 font-mono">{r.code}</td>
                  <td className={cn("px-2 py-1", r.status === "ERROR" && "text-destructive")}>{r.status === "ERROR" ? r.error : r.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.advance ? rupees(r.advance.amount) : ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.advance ? rupees(r.advance.amount - r.advance.recoveredBefore) : ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.advance ? rupees(r.advance.instalment) : ""}</td>
                  <td className="px-2 py-1">{r.advance ? monthLabel(r.advance.startMonth) : ""}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={busy || !plan || plan.errors > 0 || plan.rows.length === 0} onClick={() => run("apply")}>{busy ? "Working..." : `Add ${plan ? plan.rows.length - bad.length : 0} advances`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
