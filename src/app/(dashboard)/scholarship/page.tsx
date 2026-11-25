"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, exportToCSV } from "@/lib/utils";
import { academicYearOf } from "@/lib/fees/rules";
import { downloadTemplate, readSheet } from "@/components/fees/scholarshipExcel";
import { CollegePicker, useFeeCollege } from "@/components/fees/CollegePicker";

// Scholarship Cell (location; pick the college) > FR / NFR Students: the Category A students of an academic year (their fees raised by Accounts).
// FR = fee reimbursement - the government pays the FR-covered heads; NFR = the student pays all. Change one student,
// or upload an Excel list (Regd. No + FR / NFR); every change is checked first. Spot and Category B students always
// pay themselves and are not listed.

interface Row {
  id: string; rollNumber: string; name: string; department: string; section: string; courseName: string; batch: string; funding: "FR" | "NFR"; fundingNote: string;
  gross: number; frCoveredFee: number; govtShare: number; govtReceived: number; studentShare: number; paid: number; balance: number;
}
interface Check { row: number; rollNumber: string; name: string; from: string | null; to: string | null; error?: string; change?: boolean; studentShareFrom?: number; studentShareTo?: number; paidExtra?: number }
const rupee = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

export default function ScholarshipHomePage() {
  const current = academicYearOf(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  const years = [1, 0, -1, -2].map((d) => { const s = Number(current.slice(0, 4)) + d; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; });
  const [year, setYear] = useState(current);
  const { colleges, collegeId, setCollegeId } = useFeeCollege();
  const qc = `collegeId=${encodeURIComponent(collegeId)}`;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState({ q: "", dept: "", batch: "", funding: "" });
  const [pending, setPending] = useState<{ rows: { rollNumber: string; funding: string; note?: string }[]; checks: Check[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!collegeId) return;
    let live = true;
    fetch(`/api/college/fees/scholarship?academicYear=${year}&${qc}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Unable to load the students."); return d.rows as Row[]; })
      .then((d) => { if (live) setRows(d); })
      .catch((e: Error) => { if (live) toast({ variant: "destructive", title: e.message }); });
    return () => { live = false; };
  }, [year, tick, collegeId, qc]);

  const depts = useMemo(() => [...new Set((rows ?? []).map((r) => r.department))].sort(), [rows]);
  const batches = useMemo(() => [...new Set((rows ?? []).map((r) => r.batch))].sort().reverse(), [rows]);
  const q = filter.q.trim().toUpperCase();
  const shown = (rows ?? []).filter((r) => (!q || r.rollNumber.toUpperCase().startsWith(q) || r.name.toUpperCase().includes(q)) && (!filter.dept || r.department === filter.dept) && (!filter.batch || r.batch === filter.batch) && (!filter.funding || r.funding === filter.funding));

  async function check(list: { rollNumber: string; funding: string; note?: string }[]) {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/fees/scholarship/funding?${qc}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ academicYear: year, apply: false, rows: list }) });
      const d = (await res.json()) as { checks?: Check[]; error?: string };
      if (!res.ok || !d.checks) throw new Error(d.error ?? "Unable to check the list.");
      setPending({ rows: list, checks: d.checks });
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/college/fees/scholarship/funding?${qc}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ academicYear: year, apply: true, rows: pending.rows }) });
      const d = (await res.json()) as { changed?: number; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to save the changes.");
      toast({ variant: "success", title: `${d.changed ?? 0} student${d.changed === 1 ? "" : "s"} updated.` });
      setPending(null); setTick((n) => n + 1);
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    const r = await readSheet(file, { rollNumber: ["Regd. No", "Regd No", "Roll No", "Student Registration No"], funding: ["FR / NFR", "FR/NFR", "Funding", "FR"] });
    if ("error" in r) { toast({ variant: "destructive", title: r.error }); return; }
    if (!r.rows.length) { toast({ variant: "destructive", title: "The file has no student rows." }); return; }
    await check(r.rows.map((x) => ({ rollNumber: x.rollNumber, funding: x.funding })));
  }
  const counts = { fr: (rows ?? []).filter((r) => r.funding === "FR").length, nfr: (rows ?? []).filter((r) => r.funding === "NFR").length };
  const problems = pending?.checks.filter((c) => c.error).length ?? 0;
  const changes = pending?.checks.filter((c) => !c.error && c.change).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="FR / NFR Students" description="Category A students: FR when the government reimburses their fee (the FR-covered heads), NFR when they pay it all. Spot and Category B students always pay themselves." />
      <CollegePicker colleges={colleges} collegeId={collegeId} onChange={(id) => { setRows(null); setCollegeId(id); }} />
      {collegeId && <>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32 space-y-1"><Label className="text-xs">Academic Year</Label><select className={selectClass} value={year} onChange={(e) => { setRows(null); setYear(e.target.value); }}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
        <div className="w-48 space-y-1"><Label className="text-xs">Find</Label><Input value={filter.q} placeholder="Regd. No or name" onChange={(e) => setFilter({ ...filter, q: e.target.value })} /></div>
        <div className="w-56 space-y-1"><Label className="text-xs">Department</Label><select className={selectClass} value={filter.dept} onChange={(e) => setFilter({ ...filter, dept: e.target.value })}><option value="">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
        <div className="w-36 space-y-1"><Label className="text-xs">Batch</Label><select className={selectClass} value={filter.batch} onChange={(e) => setFilter({ ...filter, batch: e.target.value })}><option value="">All batches</option>{batches.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
        <div className="w-32 space-y-1"><Label className="text-xs">FR / NFR</Label><select className={selectClass} value={filter.funding} onChange={(e) => setFilter({ ...filter, funding: e.target.value })}><option value="">Both</option><option value="FR">FR</option><option value="NFR">NFR</option></select></div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => void downloadTemplate("FR_NFR_Template", ["Regd. No", "FR / NFR"], ["26BV1A0501", "FR"])}><Download className="mr-1 h-4 w-4" />Template</Button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          <Button loading={busy && !pending} onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-4 w-4" />Upload FR / NFR List</Button>
        </div>
      </div>
      {rows === null ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No Category A fee accounts for {year} yet. Accounts raises the fees first.</p> : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg border px-3 py-2"><b>{rows.length}</b> Category A students</span>
            <span className="rounded-lg border border-emerald-400 px-3 py-2"><b>{counts.fr}</b> FR</span>
            <span className="rounded-lg border px-3 py-2"><b>{counts.nfr}</b> NFR</span>
            <span className="rounded-lg border px-3 py-2">Government share <b>{rupee(rows.reduce((n, r) => n + r.govtShare, 0))}</b> · received <b>{rupee(rows.reduce((n, r) => n + r.govtReceived, 0))}</b></span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => exportToCSV(shown.map((r) => ({ ...r })), `FR_NFR_${year}`, [
              { key: "rollNumber", header: "Regd. No" }, { key: "name", header: "Name" }, { key: "department", header: "Department" }, { key: "section", header: "Section" }, { key: "batch", header: "Batch" },
              { key: "funding", header: "FR / NFR" }, { key: "gross", header: "Fee" }, { key: "govtShare", header: "Government Share" }, { key: "govtReceived", header: "Government Received" }, { key: "studentShare", header: "Student Pays" }, { key: "paid", header: "Student Paid" },
            ])}><Download className="mr-1 h-4 w-4" />CSV</Button>
          </div>
          <Card><CardContent className="max-h-[34rem] overflow-auto p-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr>{["Regd. No", "Name", "Department · Section", "Batch", "Fee", "Government", "Student Pays", "FR / NFR"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">{shown.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5 tabular-nums">{r.rollNumber}</td>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-xs">{r.department} · {r.section}</td>
                  <td className="px-3 py-1.5 text-xs">{r.batch}</td>
                  <td className="px-3 py-1.5 tabular-nums">{rupee(r.gross)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.govtShare ? `${rupee(r.govtShare)}` : "-"}{r.govtShare ? <span className="block text-[11px] text-muted-foreground">received {rupee(r.govtReceived)}</span> : null}</td>
                  <td className="px-3 py-1.5 tabular-nums">{rupee(r.studentShare)}{r.balance < 0 && <span className="block text-[11px] text-destructive">paid extra {rupee(-r.balance)}</span>}</td>
                  <td className="px-3 py-1.5">
                    <div className="inline-flex overflow-hidden rounded-md border text-xs">
                      {(["FR", "NFR"] as const).map((f) => (
                        <button key={f} type="button" disabled={busy || r.funding === f} onClick={() => void check([{ rollNumber: r.rollNumber, funding: f }])}
                          className={cn("px-2.5 py-1 font-medium", r.funding === f ? (f === "FR" ? "bg-emerald-600 text-white" : "bg-foreground text-background") : "hover:bg-muted")}>{f}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {shown.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No students match.</p>}
          </CardContent></Card>
        </>
      )}
      </>}

      {pending && (
        <Dialog open onOpenChange={(o) => { if (!o && !busy) setPending(null); }}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Check FR / NFR Changes</DialogTitle>
              <DialogDescription>{changes} change{changes === 1 ? "" : "s"}{problems ? `, ${problems} row${problems === 1 ? "" : "s"} with problems - fix the file and upload again` : ""}. Students are told when their FR / NFR changes.</DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr>{["Regd. No", "Name", "Change", "Student Pays", "Note"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y">{pending.checks.filter((c) => c.error || c.change).map((c) => (
                  <tr key={c.row} className={c.error ? "text-destructive" : ""}>
                    <td className="px-3 py-1.5 tabular-nums">{c.rollNumber || `Row ${c.row}`}</td>
                    <td className="px-3 py-1.5">{c.name}</td>
                    <td className="px-3 py-1.5 text-xs">{c.error ? "-" : `${c.from} → ${c.to}`}</td>
                    <td className="px-3 py-1.5 text-xs tabular-nums">{c.error ? "" : `${rupee(c.studentShareFrom ?? 0)} → ${rupee(c.studentShareTo ?? 0)}`}</td>
                    <td className="px-3 py-1.5 text-xs">{c.error ?? (c.paidExtra ? `Already paid ${rupee(c.paidExtra)} more than the new amount - Accounts refunds or carries it forward.` : "")}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!changes && !problems && <p className="p-4 text-sm text-muted-foreground">Nothing changes - every student is already as listed.</p>}
            </div>
            <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPending(null)}>Cancel</Button><Button loading={busy} disabled={!!problems || !changes} onClick={() => void apply()}>Save {changes} Change{changes === 1 ? "" : "s"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
