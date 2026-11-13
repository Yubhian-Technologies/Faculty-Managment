"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { parseCSVWithRowNumbers, parseExcelFileWithRowNumbers, readFileAsText } from "@/lib/utils/csv";
import type { DeductionPlan } from "@/lib/payroll/monthlyDeductions";
import type { PayrollLine, PayrollRun } from "@/types/payroll";
import { collegeQs, monthLabel, payrollFetch, rupees } from "./payrollClient";

// This month's deductions entered each month (MediClaim ...) from a file: Employee ID + one column per such deduction.
// The template comes with everyone in the month and their current amounts. Blank = left as it is, 0 = none this
// month. Check first; Save changes nothing unless every row is clean.

const CODE_HEADERS = new Set(["EMPCODE", "EMPLOYEECODE", "EMPLOYEEID"]);
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

type FileRows = { name: string; headers: string[]; rows: { row: number; code: string; values: Record<string, string> }[] };

export function MonthlyDeductionsDialog({ collegeId, run, lines, onClose, onDone }: {
  collegeId?: string; run: PayrollRun; lines: PayrollLine[]; onClose: () => void; onDone: () => void;
}) {
  const [file, setFile] = useState<FileRows | null>(null);
  const [plan, setPlan] = useState<(DeductionPlan & { applied: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/college/payroll/runs/${run.month}/deductions-import${collegeQs(collegeId)}`;
  const monthly = run.settings.deductions.filter((d) => d.kind === "MANUAL" && d.active);

  async function template() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(monthLabel(run.month));
    const headers = ["Employee ID", "Name", ...monthly.map((d) => d.label)];
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    for (const l of [...lines].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))) ws.addRow([l.employeeCode, l.name, ...monthly.map((d) => l.manual?.[d.id] ?? "")]);
    ws.columns = headers.map((h, i) => ({ width: i === 1 ? 32 : Math.max(h.length + 4, 12) }));
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `Deductions_${run.month}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
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
      const headAt = parsed.rows.slice(0, 15).findIndex((r) => r.some((c) => CODE_HEADERS.has(norm(String(c ?? "")))));
      if (headAt < 0) throw new Error('The file needs an "Employee ID" column');
      const headers = parsed.rows[headAt].map((h) => String(h ?? "").trim());
      const codeAt = headers.findIndex((h) => CODE_HEADERS.has(norm(h)));
      const rows = parsed.rows.slice(headAt + 1).map((r, i) => ({
        row: parsed.rowNumbers[headAt + 1 + i] ?? headAt + i + 2, code: String(r[codeAt] ?? "").trim(),
        values: Object.fromEntries(headers.map((h, j) => [h, String(r[j] ?? "").trim()])),
      })).filter((r) => Object.values(r.values).some(Boolean));
      if (rows.length === 0) throw new Error("No rows under the header");
      const next = { name: f.name, headers, rows };
      setFile(next);
      await send("preview", next);
    } catch (err) { toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to read the file" }); }
  }

  async function send(mode: "preview" | "apply", body: FileRows | null = file) {
    if (!body) return;
    setBusy(true);
    try {
      const d = await payrollFetch<DeductionPlan & { applied: number }>(url, { method: "POST", body: JSON.stringify({ mode, rev: run.rev, headers: body.headers, rows: body.rows }) });
      setPlan(d);
      if (mode === "apply") { toast({ variant: "success", title: `Deductions saved for ${d.applied} people` }); onDone(); }
    } catch (err) {
      const data = (err as { data?: DeductionPlan & { applied: number } }).data;
      if (data?.rows) setPlan(data);
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to import" });
    } finally { setBusy(false); }
  }

  const count = (s: "CHANGED" | "SAME" | "ERROR") => plan?.rows.filter((r) => r.status === s).length ?? 0;
  const shown = plan ? [...plan.rows.filter((r) => r.status === "ERROR"), ...plan.rows.filter((r) => r.status === "CHANGED")] : [];
  const canApply = !!plan && plan.errors === 0 && count("CHANGED") > 0;
  const fmt = (m: Record<string, number> | undefined) => (plan?.columns ?? []).map((c) => `${c.label} ${rupees(m?.[c.id] ?? 0)}`).join(" · ");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Monthly deductions - {monthLabel(run.month)}</DialogTitle>
          <DialogDescription>
            Employee ID + a column for each deduction entered each month ({monthly.map((d) => d.label).join(", ") || "none set up yet"}). The template has everyone in this month with their current amounts.
            A blank cell leaves it as it is; 0 means none this month. Your salary sheet works too - its other columns are ignored.
          </DialogDescription>
        </DialogHeader>
        {monthly.length === 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            No monthly deduction is set up for this month. Accounts can add one in Pay Parts and Rules (for example, MediClaim, entered each month). If it was added after this month was prepared, choose Recalculate first.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Button variant="outline" onClick={template} disabled={monthly.length === 0}><Download className="mr-1.5 h-4 w-4" />Template</Button>
          <Button variant="outline" asChild><label className="cursor-pointer"><Upload className="mr-1.5 h-4 w-4" />Upload file<input type="file" accept=".xlsx,.csv" className="sr-only" onChange={pick} /></label></Button>
          {file && <span className="text-xs text-muted-foreground">{file.name} · {file.rows.length} rows</span>}
        </div>
        {plan && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200">{count("CHANGED")} changed</span>
              <span className="rounded-full bg-muted px-3 py-1">{count("SAME")} unchanged</span>
              {count("ERROR") > 0 && <span className="rounded-full bg-red-100 px-3 py-1 text-red-900 dark:bg-red-950/50 dark:text-red-200">{count("ERROR")} with problems</span>}
            </div>
            {plan.problem && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">{plan.problem}</p>}
            {plan.unknownColumns.length > 0 && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">Columns this import doesn&apos;t know: {plan.unknownColumns.join(", ")}. Add them in Pay parts &amp; rules, or remove them.</p>}
            {plan.skipped > 0 && <p className="text-xs text-muted-foreground">{plan.skipped} row(s) without an Employee ID skipped (totals, headings, notes).</p>}
            {shown.length > 0 && (
              <div className="max-h-80 overflow-auto rounded-md border"><table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left"><tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Employee ID</th><th className="px-2 py-1">Name / problem</th><th className="px-2 py-1">Now</th><th className="px-2 py-1">After</th></tr></thead>
                <tbody>{shown.map((r) => (
                  <tr key={r.row} className="border-t">
                    <td className="px-2 py-1">{r.row}</td><td className="px-2 py-1 font-mono">{r.code}</td>
                    <td className={`px-2 py-1 ${r.status === "ERROR" ? "text-destructive" : ""}`}>{r.status === "ERROR" ? r.error : r.name}</td>
                    <td className="px-2 py-1 tabular-nums">{r.status === "ERROR" ? "" : fmt(r.before)}</td>
                    <td className="px-2 py-1 tabular-nums">{r.status === "ERROR" ? "" : fmt(r.after)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => send("apply")} disabled={!canApply || busy}>{busy ? "Working..." : `Save for ${count("CHANGED")} people`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
