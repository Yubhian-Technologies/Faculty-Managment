"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { parseCSVWithRowNumbers, parseExcelFileWithRowNumbers, readFileAsText } from "@/lib/utils/csv";
import { exemptableDeductions, type ImportPlanRow } from "@/lib/payroll/pay";
import type { PayrollSettings } from "@/types/payroll";
import type { PayRow } from "./PayStructures";
import { collegeQs, monthLabel, payrollFetch, rupees, thisMonth } from "./payrollClient";

// Import Accounts' salary sheet: Emp Code + one column per pay part (fixed monthly amounts) + a Y/N column
// per deduction. The template comes filled with everyone's current pay. Preview first; Apply saves only
// when every row is clean (one bad row = nothing saved).

const CODE_HEADERS = new Set(["EMPCODE", "EMPLOYEECODE", "EMPLOYEEID"]);
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

type Plan = { rows: ImportPlanRow[]; unknownColumns: string[]; errors: number; blocked: string | null; applied: number };

export function PayImportDialog({ collegeId, settings, rows: people, onClose, onDone }: {
  collegeId?: string; settings: PayrollSettings; rows: PayRow[]; onClose: () => void; onDone: () => void;
}) {
  const [from, setFrom] = useState(thisMonth());
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: { row: number; code: string; values: Record<string, string> }[] } | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/college/payroll/pay/import${collegeQs(collegeId)}`;
  const parts = settings.earnings.filter((e) => e.active);
  const deds = exemptableDeductions(settings).filter((d) => d.active);

  async function template() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Pay");
    const headers = ["Emp Code", "Name", ...parts.map((e) => e.label), ...deds.map((d) => d.label)];
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    for (const p of people) {
      ws.addRow([p.employeeCode, p.name, ...parts.map((e) => p.amounts[e.id] ?? ""), ...deds.map((d) => (p.hasPay ? (p.exempt.includes(d.id) ? "N" : "Y") : ""))]);
    }
    ws.columns = headers.map((h, i) => ({ width: i === 1 ? 32 : Math.max(h.length + 4, 12) }));
    const help = wb.addWorksheet("Instructions");
    [["Column", "What to enter"], ["Emp Code", "Required - finds the person. Must match their faculty / staff record."],
      ...parts.map((e) => [e.label, "Fixed monthly amount in whole rupees (the full-month figure, not the earned one). Blank = 0."]),
      ...deds.map((d) => [d.label, "Y if it applies, N if not (e.g. no PF). Blank = Y."]),
      [], ["Name is for reading only. A person left out of the file keeps their pay."]].forEach((r) => help.addRow(r));
    help.columns = [{ width: 18 }, { width: 100 }];
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "pay_structures.xlsx"; a.click(); URL.revokeObjectURL(a.href);
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
      const codeAt = headers.findIndex((h) => CODE_HEADERS.has(norm(h)));
      if (codeAt < 0) throw new Error('The file needs an "Emp Code" column');
      const rows = parsed.rows.slice(1).map((r, i) => ({
        row: parsed.rowNumbers[i + 1] ?? i + 2, code: String(r[codeAt] ?? "").trim(),
        values: Object.fromEntries(headers.map((h, j) => [h, String(r[j] ?? "").trim()])),
      })).filter((r) => Object.values(r.values).some(Boolean));
      if (rows.length === 0) throw new Error("No rows under the header");
      setFile({ name: f.name, headers, rows });
      await run("preview", { headers, rows });
    } catch (err) { toast({ variant: "destructive", title: err instanceof Error ? err.message : "Couldn't read the file" }); }
  }

  async function run(mode: "preview" | "apply", body: { headers: string[]; rows: { row: number; code: string; values: Record<string, string> }[] } | null = file) {
    if (!body) return;
    setBusy(true);
    try {
      const d = await payrollFetch<Plan>(url, { method: "POST", body: JSON.stringify({ mode, effectiveFrom: from, headers: body.headers, rows: body.rows }) });
      setPlan(d);
      if (mode === "apply") { toast({ variant: "success", title: `Pay saved for ${d.applied} people from ${monthLabel(from)}` }); onDone(); }
    } catch (err) {
      const data = (err as { data?: Plan }).data;
      if (data?.rows) setPlan(data);
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Couldn't import" });
    } finally { setBusy(false); }
  }

  const count = (s: ImportPlanRow["status"]) => plan?.rows.filter((r) => r.status === s).length ?? 0;
  const shown = plan ? [...plan.rows.filter((r) => r.status === "ERROR"), ...plan.rows.filter((r) => r.status === "NEW" || r.status === "CHANGED")] : [];
  const canApply = !!plan && plan.errors === 0 && !plan.blocked && count("NEW") + count("CHANGED") > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import salary sheet</DialogTitle>
          <DialogDescription>Fixed monthly pay per person, matched by Emp Code. Download the template (it has everyone&apos;s current pay), change it, and upload it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="pi-from">Pay starts from</Label><Input id="pi-from" type="month" className="w-44" value={from} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setPlan(null); } }} /></div>
          <Button variant="outline" onClick={template}><Download className="mr-1.5 h-4 w-4" />Template</Button>
          <Button variant="outline" asChild><label className="cursor-pointer"><Upload className="mr-1.5 h-4 w-4" />Upload file<input type="file" accept=".xlsx,.csv" className="sr-only" onChange={pick} /></label></Button>
          {file && !plan && <Button variant="ghost" onClick={() => run("preview")} disabled={busy}>Check again</Button>}
        </div>
        {file && <p className="text-xs text-muted-foreground">{file.name} · {file.rows.length} rows</p>}
        {plan && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">{count("NEW")} new</span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200">{count("CHANGED")} changed</span>
              <span className="rounded-full bg-muted px-3 py-1">{count("SAME")} unchanged</span>
              {count("ERROR") > 0 && <span className="rounded-full bg-red-100 px-3 py-1 text-red-900 dark:bg-red-950/50 dark:text-red-200">{count("ERROR")} with problems</span>}
            </div>
            {plan.blocked && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">{plan.blocked}</p>}
            {plan.unknownColumns.length > 0 && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">Columns this import doesn&apos;t know: {plan.unknownColumns.join(", ")}. Rename them to a pay part or deduction, or remove them.</p>}
            {shown.length > 0 && (
              <div className="max-h-80 overflow-auto rounded-md border"><table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left"><tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Emp Code</th><th className="px-2 py-1">Name / problem</th><th className="px-2 py-1 text-right">Gross_Actual</th><th className="px-2 py-1">Not applied</th></tr></thead>
                <tbody>{shown.map((r) => (
                  <tr key={r.row} className="border-t">
                    <td className="px-2 py-1">{r.row}</td><td className="px-2 py-1 font-mono">{r.code}</td>
                    <td className={`px-2 py-1 ${r.status === "ERROR" ? "text-destructive" : ""}`}>{r.status === "ERROR" ? r.error : `${r.name} (${r.status === "NEW" ? "new" : "changed"})`}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.grossActual ? rupees(r.grossActual) : ""}</td>
                    <td className="px-2 py-1">{(r.exempt ?? []).join(", ")}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => run("apply")} disabled={!canApply || busy}>{busy ? "Working..." : `Save from ${monthLabel(from)}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
