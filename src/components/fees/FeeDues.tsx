"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn, dmy, exportToCSV } from "@/lib/utils";
import { feeGet, rupee, selectClass, yearChoices, type FeeOptions } from "./feeApi";
import { AccountPanel } from "./FeeCollect";

// Accounts > Fees > Dues: every fee account of the year (optionally one course / batch / category / FR-NFR) - fee,
// government share (FR) and what arrived, concession, paid, balance, overdue now with late fine - totals, filters (overdue / balance / cleared) and CSV.
// A row opens the student's account.

interface Row {
  id: string; rollNumber: string; name: string; department: string; section: string; courseName: string; batch: string; admissionType: string;
  category: "A" | "B" | "SPOT"; funding: "FR" | "NFR"; gross: number; concessionTotal: number; govtShare: number; govtReceived: number; studentShare: number; paid: number; balance: number;
  status: string; overdue: number; fine: number; nextDue: string | null;
}
type Filter = "OVERDUE" | "DUE" | "CLEARED" | "ALL";

export function FeeDues({ collegeId, options, academicYear, setAcademicYear }: { collegeId: string; options: FeeOptions; academicYear: string; setAcademicYear: (y: string) => void }) {
  const [courseKey, setCourseKey] = useState("");
  const [batch, setBatch] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter>("OVERDUE");
  const [dept, setDept] = useState("");
  const [group, setGroup] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams({ academicYear, ...(courseKey ? { courseKey } : {}), ...(batch ? { batch } : {}) });
    feeGet<{ rows: Row[] }>(`/api/college/fees/accounts?${qs}`, collegeId)
      .then((d) => { if (live) setRows(d.rows); })
      .catch((e: Error) => { if (live) toast({ variant: "destructive", title: e.message }); });
    return () => { live = false; };
  }, [collegeId, academicYear, courseKey, batch]);

  const depts = useMemo(() => [...new Set((rows ?? []).map((r) => r.department))].sort(), [rows]);
  const inDept = (rows ?? []).filter((r) => (!dept || r.department === dept) && (!group || `${r.category}-${r.funding}` === group || (group === "A" && r.category === "A") || group === r.category));
  const shown = inDept.filter((r) => filter === "ALL" || (filter === "OVERDUE" ? r.overdue > 0 : filter === "DUE" ? r.balance > 0 : r.balance <= 0));
  const sum = (k: keyof Row, list = inDept) => list.reduce((n, r) => n + (Number(r[k]) || 0), 0);

  const csv = () => exportToCSV(shown.map((r) => ({ ...r, nextDue: r.nextDue ?? "" })), `Fee_Dues_${academicYear}`, [
    { key: "rollNumber", header: "Regd. No" }, { key: "name", header: "Name" }, { key: "courseName", header: "Course" }, { key: "department", header: "Department" },
    { key: "section", header: "Section" }, { key: "batch", header: "Batch" }, { key: "admissionType", header: "Admission Type" }, { key: "gross", header: "Fee" },
    { key: "category", header: "Category" }, { key: "funding", header: "FR / NFR" }, { key: "govtShare", header: "Government (FR)" }, { key: "govtReceived", header: "Government Received" },
    { key: "concessionTotal", header: "Concession" },
    { key: "studentShare", header: "Student Pays" }, { key: "paid", header: "Paid" }, { key: "balance", header: "Balance" }, { key: "overdue", header: "Overdue" },
    { key: "fine", header: "Late Fine" }, { key: "nextDue", header: "Next Due" },
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32 space-y-1"><Label className="text-xs">Academic Year</Label><select className={selectClass} value={academicYear} onChange={(e) => setAcademicYear(e.target.value)}>{yearChoices(options.academicYear).map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
        <div className="w-56 space-y-1"><Label className="text-xs">Course</Label><select className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setBatch(""); }}><option value="">All courses</option>{options.courses.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></div>
        <div className="w-36 space-y-1"><Label className="text-xs">Batch</Label><select className={selectClass} value={batch} disabled={!courseKey} onChange={(e) => setBatch(e.target.value)}><option value="">All batches</option>{(options.batchesByCourse[courseKey] ?? []).map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
        <div className="w-56 space-y-1"><Label className="text-xs">Department</Label><select className={selectClass} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
        <div className="w-48 space-y-1"><Label className="text-xs">Category</Label><select className={selectClass} value={group} onChange={(e) => setGroup(e.target.value)}><option value="">All categories</option><option value="A-FR">Category A - FR</option><option value="A-NFR">Category A - NFR</option><option value="SPOT">Spot</option><option value="B">Category B</option></select></div>
        <Button variant="outline" className="ml-auto" disabled={!shown.length} onClick={csv}><Download className="mr-1 h-4 w-4" />CSV</Button>
      </div>
      {rows === null ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <Tile label="Students" value={String(inDept.length)} />
            <Tile label="Fee" value={rupee(sum("gross"))} />
            <Tile label="Government (FR)" value={rupee(sum("govtShare"))} sub={`received ${rupee(sum("govtReceived"))}`} />
            <Tile label="Collected" value={rupee(sum("paid"))} tone="text-emerald-700 dark:text-emerald-300" />
            <Tile label="Balance" value={rupee(inDept.reduce((n, r) => n + Math.max(0, r.balance), 0))} tone="text-amber-700 dark:text-amber-300" />
            <Tile label="Overdue Now" value={rupee(sum("overdue"))} tone="text-destructive" sub={`${inDept.filter((r) => r.overdue > 0).length} students`} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([["OVERDUE", "Overdue", inDept.filter((r) => r.overdue > 0).length], ["DUE", "Balance Due", inDept.filter((r) => r.balance > 0).length], ["CLEARED", "Cleared", inDept.filter((r) => r.balance <= 0).length], ["ALL", "All", inDept.length]] as [Filter, string, number][]).map(([k, l, n]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === k ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary")}>{l} ({n})</button>
            ))}
          </div>
          <Card><CardContent className="max-h-[32rem] overflow-auto p-0">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr>{["Regd. No", "Name", "Department · Section", "Category", "Student Pays", "Paid", "Balance", "Overdue", "Next Due"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">{shown.map((r) => (
                <tr key={r.id} className={cn("cursor-pointer hover:bg-muted/30", open === r.id && "bg-muted/40")} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="px-3 py-1.5 tabular-nums">{r.rollNumber}</td>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-xs">{r.department} · {r.section}</td>
                  <td className="px-3 py-1.5 text-xs">{r.category === "SPOT" ? "Spot" : r.category}{r.category === "A" ? ` · ${r.funding}` : ""}</td>
                  <td className="px-3 py-1.5 tabular-nums">{rupee(r.studentShare)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{rupee(r.paid)}</td>
                  <td className={cn("px-3 py-1.5 font-medium tabular-nums", r.balance < 0 && "text-destructive")}>{r.balance < 0 ? `Extra ${rupee(-r.balance)}` : rupee(r.balance)}</td>
                  <td className={cn("px-3 py-1.5 tabular-nums", r.overdue > 0 && "font-medium text-destructive")}>{r.overdue ? `${rupee(r.overdue)}${r.fine ? ` + ${rupee(r.fine)}` : ""}` : "-"}</td>
                  <td className="px-3 py-1.5">{r.nextDue ? dmy(r.nextDue) : "-"}</td>
                </tr>
              ))}</tbody>
            </table>
            {shown.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{rows.length ? "None." : `No fee accounts for ${academicYear} yet. Raise fees first.`}</p>}
          </CardContent></Card>
          {open && <AccountPanel key={open} collegeId={collegeId} accountId={open} today={options.today} />}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</p>{sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}</div>;
}
