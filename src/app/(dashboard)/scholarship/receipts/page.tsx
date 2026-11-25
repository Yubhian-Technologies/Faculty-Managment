"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { dmy } from "@/lib/utils";
import { academicYearOf } from "@/lib/fees/rules";
import { downloadTemplate, readSheet } from "@/components/fees/scholarshipExcel";
import { CollegePicker, useFeeCollege } from "@/components/fees/CollegePicker";

// Scholarship Cell > Government Receipts: fee reimbursement money the government paid into the college account -
// the date, the reference (government order / UTR) and an Excel list of Regd. No + amount for FR students. Checked
// first; saving adds to each student's "government received" (shown to Accounts against the government's share).

interface Check { row: number; rollNumber: string; name: string; amount: number; error?: string; govtShare?: number; receivedAfter?: number; note?: string }
interface Credit { id: string; receivedOn: string; reference: string; scheme: string; total: number; students: number; byName: string }
const rupee = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

export default function GovtReceiptsPage() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const current = academicYearOf(today);
  const years = [1, 0, -1, -2].map((d) => { const s = Number(current.slice(0, 4)) + d; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; });
  const [year, setYear] = useState(current);
  const { colleges, collegeId, setCollegeId } = useFeeCollege();
  const qc = `collegeId=${encodeURIComponent(collegeId)}`;
  const [credits, setCredits] = useState<Credit[] | null>(null);
  const [f, setF] = useState({ receivedOn: today, reference: "", scheme: "" });
  const [list, setList] = useState<{ rollNumber: string; amount: string }[] | null>(null);
  const [checks, setChecks] = useState<{ checks: Check[]; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!collegeId) return;
    let live = true;
    fetch(`/api/college/fees/scholarship/received?academicYear=${year}&${qc}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Unable to load the receipts."); return d.credits as Credit[]; })
      .then((d) => { if (live) setCredits(d); })
      .catch((e: Error) => { if (live) toast({ variant: "destructive", title: e.message }); });
    return () => { live = false; };
  }, [year, tick, collegeId, qc]);

  async function send(apply: boolean, rows = list) {
    if (!rows) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/college/fees/scholarship/received?${qc}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ academicYear: year, ...f, apply, rows: rows.map((r) => ({ rollNumber: r.rollNumber, amount: Number(r.amount) })) }) });
      const d = (await res.json()) as { checks?: Check[]; total?: number; error?: string };
      if (!res.ok || !d.checks) throw new Error(d.error ?? "Unable to check the list.");
      if (apply) { toast({ variant: "success", title: `Government receipt of ${rupee(d.total ?? 0)} recorded.` }); setList(null); setChecks(null); setF({ receivedOn: today, reference: "", scheme: "" }); setTick((n) => n + 1); }
      else setChecks({ checks: d.checks, total: d.total ?? 0 });
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    const r = await readSheet(file, { rollNumber: ["Regd. No", "Regd No", "Roll No", "Student Registration No"], amount: ["Amount", "Amount Received", "Fee Reimbursement"] });
    if ("error" in r) { toast({ variant: "destructive", title: r.error }); return; }
    const rows = r.rows.map((x) => ({ rollNumber: x.rollNumber, amount: x.amount.replace(/[,₹\s]/g, "") }));
    setList(rows); await send(false, rows);
  }
  const problems = checks?.checks.filter((c) => c.error).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Government Receipts" description="Fee reimbursement money the government paid into the college account, student by student." />
      <CollegePicker colleges={colleges} collegeId={collegeId} onChange={(id) => { setCredits(null); setChecks(null); setCollegeId(id); }} />
      {collegeId && <>
      <Card><CardContent className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1"><Label className="text-xs">Academic Year</Label><select className={selectClass} value={year} onChange={(e) => { setCredits(null); setChecks(null); setYear(e.target.value); }}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
          <div className="space-y-1"><Label className="text-xs">Received On</Label><Input type="date" value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Reference (G.O. / UTR)</Label><Input value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Scheme (optional)</Label><Input value={f.scheme} maxLength={80} placeholder="e.g. Vidya Deevena" onChange={(e) => setF({ ...f, scheme: e.target.value })} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void downloadTemplate("Government_Receipt_Template", ["Regd. No", "Amount"], ["26BV1A0501", 45000])}><Download className="mr-1 h-4 w-4" />Template</Button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
          <Button variant="outline" disabled={!f.reference.trim()} loading={busy && !checks} onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-4 w-4" />Upload Student List</Button>
          {!f.reference.trim() && <span className="self-center text-xs text-muted-foreground">Enter the reference first.</span>}
        </div>
        {checks && (
          <div className="space-y-2">
            <p className="text-sm">{checks.checks.length} students · total <b>{rupee(checks.total)}</b>{problems ? <span className="text-destructive"> · {problems} with problems - fix the file and upload again</span> : null}</p>
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr>{["Regd. No", "Name", "Amount", "Government Share", "Received After", "Note"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y">{checks.checks.map((c) => (
                  <tr key={c.row} className={c.error ? "text-destructive" : ""}>
                    <td className="px-3 py-1.5 tabular-nums">{c.rollNumber || `Row ${c.row}`}</td><td className="px-3 py-1.5">{c.name}</td>
                    <td className="px-3 py-1.5 tabular-nums">{Number.isFinite(c.amount) ? rupee(c.amount) : "-"}</td>
                    <td className="px-3 py-1.5 tabular-nums">{c.govtShare != null ? rupee(c.govtShare) : ""}</td>
                    <td className="px-3 py-1.5 tabular-nums">{c.receivedAfter != null ? rupee(c.receivedAfter) : ""}</td>
                    <td className="px-3 py-1.5 text-xs">{c.error ?? c.note ?? ""}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setChecks(null); setList(null); }}>Cancel</Button><Button loading={busy} disabled={!!problems} onClick={() => void send(true)}>Record {rupee(checks.total)}</Button></div>
          </div>
        )}
      </CardContent></Card>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Recorded for {year}</p>
        {credits === null ? <div className="h-20 animate-pulse rounded-lg bg-muted" /> : credits.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
          <Card><CardContent className="p-0"><table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>{["Received On", "Reference", "Scheme", "Students", "Total", "Recorded By"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y">{credits.map((c) => (
              <tr key={c.id}><td className="px-3 py-2">{dmy(c.receivedOn)}</td><td className="px-3 py-2">{c.reference}</td><td className="px-3 py-2">{c.scheme || "-"}</td><td className="px-3 py-2 tabular-nums">{c.students}</td><td className="px-3 py-2 font-medium tabular-nums">{rupee(c.total)}</td><td className="px-3 py-2 text-xs">{c.byName}</td></tr>
            ))}</tbody>
          </table></CardContent></Card>
        )}
      </div>
      </>}
    </div>
  );
}
