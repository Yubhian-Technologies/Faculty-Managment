"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { Download, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getJson } from "@/components/dashboard/DashboardParts";
import { toast } from "@/hooks/useToast";
import { parseExcelFile } from "@/lib/utils/csv";
import { CANDIDATE_IMPORT_HEADERS, MAX_IMPORT_ROWS, matchHeaders, type ImportRow, type RowResult } from "@/lib/hiring/candidateImport";
import type { VacancyRequest } from "@/types";

// Candidate Excel import (HR, also usable by the HOD / Principal): template -> upload -> every row checked (nothing
// saved) -> optionally pick an approved hiring request to attach everyone to -> Import. POST /api/college/candidates/import.

const NONE = "none";

async function downloadTemplate() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Candidates");
  sheet.addRow([...CANDIDATE_IMPORT_HEADERS]).font = { bold: true };
  CANDIDATE_IMPORT_HEADERS.forEach((h, i) => { sheet.getColumn(i + 1).width = h === "Address" ? 40 : 22; });
  const help = wb.addWorksheet("How to Fill");
  [
    ["Column", "What to enter"],
    ["Name", "Required. The candidate's full name."],
    ["Email", "Required."],
    ["Mobile", "Required. 10 digits starting 6-9 (+91 or a leading 0 is dropped)."],
    ["Source", "Walk-in, Advertisement, Referral or Careers Page. Blank = Advertisement."],
    ["Referred By", "Only for Referral: who referred them."],
    ["Address", "Optional."],
    [],
    ["Example (do not copy into the Candidates sheet)"],
    ["Ravi Kumar", "ravi.kumar@example.com", "9848012345", "Referral", "Dr. P. Rao", "Bhimavaram"],
  ].forEach((r) => help.addRow(r));
  help.getRow(1).font = { bold: true };
  help.getColumn(1).width = 26; help.getColumn(2).width = 60;
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = "candidate-import-template.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function CandidateImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (o: boolean) => void; onImported: () => void }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [vacancyId, setVacancyId] = useState(NONE);
  const [busy, setBusy] = useState(false);
  const vac = useQuery({
    queryKey: ["hr-vacancies-approved"],
    queryFn: () => getJson<{ vacancyRequests: VacancyRequest[] }>("/api/college/vacancy-requests?status=APPROVED"),
    enabled: open,
  });
  const approved = (vac.data?.vacancyRequests ?? []).filter((v) => v.status === "APPROVED" && v.requiredCount > 0);

  const reset = () => { setRows(null); setResults(null); setFileName(""); setVacancyId(NONE); };
  const send = async (list: ImportRow[], apply: boolean) => {
    const res = await fetch("/api/college/candidates/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: list, apply, ...(vacancyId !== NONE ? { vacancyRequestId: vacancyId } : {}) }),
    });
    const json = (await res.json()) as { results?: RowResult[]; added?: number; error?: string };
    if (!res.ok) throw new Error(json.error ?? "Unable to import the candidates.");
    return json;
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const sheet = await parseExcelFile(file);
      const headerAt = sheet.findIndex((r) => !matchHeaders(r).error);
      if (headerAt < 0) throw new Error(matchHeaders(sheet[0] ?? []).error ?? "The sheet has no header row.");
      const { index } = matchHeaders(sheet[headerAt]);
      const cell = (r: string[], k: keyof typeof index) => (index[k] >= 0 ? String(r[index[k]] ?? "") : "");
      const list = sheet.slice(headerAt + 1).filter((r) => r.some((c) => String(c ?? "").trim()))
        .map((r) => ({ name: cell(r, "Name"), email: cell(r, "Email"), mobile: cell(r, "Mobile"), source: cell(r, "Source"), referredBy: cell(r, "Referred By"), address: cell(r, "Address") }));
      if (list.length === 0) throw new Error("The file has no candidate rows.");
      if (list.length > MAX_IMPORT_ROWS) throw new Error(`Upload at most ${MAX_IMPORT_ROWS} candidates at a time.`);
      setRows(list); setFileName(file.name);
      setResults((await send(list, false)).results ?? []);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to read the file." });
    } finally { setBusy(false); }
  };

  const ok = results?.filter((r) => r.ok).length ?? 0;
  const doImport = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const json = await send(rows, true);
      toast({ variant: "success", title: `${json.added ?? 0} candidate${json.added === 1 ? "" : "s"} added.` });
      onImported(); reset(); onOpenChange(false);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to import the candidates." });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Candidates</DialogTitle>
          <DialogDescription>Upload an Excel file of candidates. Every row is checked first; nothing is saved until you choose Import.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate()}><Download className="mr-1.5 h-4 w-4" />Download Template</Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
              <Upload className="h-4 w-4" />{fileName || "Choose File"}
              <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onFile(f); }} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Attach Everyone to a Hiring Request (optional)</span>
            <Select value={vacancyId} onValueChange={setVacancyId}>
              <SelectTrigger className="max-w-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Don&apos;t attach - add to the candidate pool only</SelectItem>
                {approved.map((v) => <SelectItem key={v.id} value={v.id}>{v.position} · {v.department} ({v.requiredCount} open)</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          {results && (
            <div className="space-y-2">
              <p className="text-sm"><b>{ok}</b> of {results.length} rows ready to import{results.length - ok > 0 ? `; ${results.length - ok} will be skipped` : ""}.</p>
              {results.some((r) => !r.ok) && (
                <div className="max-h-60 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Why It Is Skipped</th></tr></thead>
                    <tbody className="divide-y">
                      {results.filter((r): r is Extract<RowResult, { ok: false }> => !r.ok).map((r) => (
                        <tr key={r.row}><td className="px-3 py-1.5 tabular-nums">{r.row}</td><td className="px-3 py-1.5">{rows?.[r.row - 2]?.name || "-"}</td><td className="px-3 py-1.5 text-amber-800 dark:text-amber-300">{r.reason}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!results || ok === 0 || busy} onClick={() => void doImport()}>{busy ? "Working..." : `Import ${ok} Candidate${ok === 1 ? "" : "s"}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
