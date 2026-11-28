"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { feeSend, rupee, selectClass, yearChoices, type FeeOptions } from "./feeApi";

// Accounts > Fees > Raise Fees: a course + batch's students get the year's fee from the published structure of their
// category (Setup maps admission types to A / Spot / B; Spot takes the Category A fee). Category A students keep their
// FR / NFR (new ones start NFR until the Scholarship Cell marks them FR). Check first (nothing written), then Raise.
// Accounts with payments are never changed; students with no category or no structure are listed to fix.

interface Row { studentId: string; rollNumber: string; name: string; section: string; admissionType: string; category: "A" | "B" | "SPOT" | null; funding?: "FR" | "NFR"; outcome: "NEW" | "UPDATED" | "KEPT" | "NO_STRUCTURE" | "NO_CATEGORY"; total?: number; studentShare?: number; note?: string }
const LABEL: Record<Row["outcome"], string> = { NEW: "New", UPDATED: "Updated", KEPT: "Kept (has payments)", NO_STRUCTURE: "No fee structure", NO_CATEGORY: "No category" };
const TONE: Record<Row["outcome"], string> = { NEW: "text-emerald-700 dark:text-emerald-300", UPDATED: "text-blue-700 dark:text-blue-300", KEPT: "text-muted-foreground", NO_STRUCTURE: "text-destructive", NO_CATEGORY: "text-destructive" };

export function RaiseFees({ collegeId, options, academicYear, setAcademicYear }: { collegeId: string; options: FeeOptions; academicYear: string; setAcademicYear: (y: string) => void }) {
  const [courseKey, setCourseKey] = useState(options.courses[0]?.key ?? "");
  const [batch, setBatch] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState<null | "check" | "apply">(null);
  const batches = options.batchesByCourse[courseKey] ?? [];

  async function run(apply: boolean) {
    setBusy(apply ? "apply" : "check");
    try {
      const d = await feeSend<{ rows: Row[] }>("/api/college/fees/raise", collegeId, "POST", { academicYear, courseKey, batch, apply, ...(rollNumber ? { rollNumber } : {}) });
      setRows(d.rows); setApplied(apply);
      if (apply) toast({ variant: "success", title: `Fees raised for ${d.rows.filter((r) => r.outcome === "NEW" || r.outcome === "UPDATED").length} students.` });
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(null); }
  }

  const count = (o: Row["outcome"]) => rows?.filter((r) => r.outcome === o).length ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Raise Fees</CardTitle>
        <CardDescription>Assigns the annual fee to all current students of a selected course and batch based on the published fee structure for their admission category. Alternatively, fees can be assigned to an individual student using their Registration Number (for late admissions). Review and verify the details before raising fees; no changes are saved until the action is confirmed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_10rem_10rem_auto]">
          <div className="space-y-1"><Label className="text-xs">Academic Year</Label><select className={selectClass} value={academicYear} onChange={(e) => { setAcademicYear(e.target.value); setRows(null); }}>{yearChoices(options.academicYear).map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
          <div className="space-y-1"><Label className="text-xs">Course</Label><select className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setBatch(""); setRows(null); }}>{options.courses.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></div>
          <div className="space-y-1"><Label className="text-xs">Batch</Label>
            <Input list="raise-batches" value={batch} placeholder="2026-2030" onChange={(e) => { setBatch(e.target.value.trim()); setRows(null); }} />
            <datalist id="raise-batches">{batches.map((b) => <option key={b} value={b} />)}</datalist>
          </div>
          <div className="space-y-1"><Label className="text-xs">Regd. No (Optional)</Label>
            <Input value={rollNumber} placeholder="Only this student" onChange={(e) => { setRollNumber(e.target.value.trim().toUpperCase()); setRows(null); }} />
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" disabled={!batch || !!busy} loading={busy === "check"} onClick={() => void run(false)}>Check</Button>
            {rows && !applied && <Button disabled={!!busy || !(count("NEW") + count("UPDATED"))} loading={busy === "apply"} onClick={() => void run(true)}>Raise for {rollNumber && count("NEW") + count("UPDATED") === 1 ? rollNumber : count("NEW") + count("UPDATED")}</Button>}
          </div>
        </div>
        {rows && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              {(["NEW", "UPDATED", "KEPT", "NO_CATEGORY", "NO_STRUCTURE"] as const).map((o) => <span key={o} className={cn("rounded-full border px-2.5 py-1", TONE[o])}><b>{count(o)}</b> {LABEL[o]}</span>)}
              {applied && <span className="rounded-full border border-emerald-400 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">Saved</span>}
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr>{["Regd. No", "Name", "Section", "Admission Type", "Category", "Fee", "Student Pays", "Result"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.studentId}>
                      <td className="px-3 py-1.5 tabular-nums">{r.rollNumber || "-"}</td>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5">{r.section}</td>
                      <td className="px-3 py-1.5">{r.admissionType || <span className="text-muted-foreground">Not on record</span>}</td>
                      <td className="px-3 py-1.5 text-xs">{r.category ? `${r.category === "SPOT" ? "Spot" : r.category}${r.category === "A" && r.funding ? ` · ${r.funding}` : ""}` : "-"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.total != null ? rupee(r.total) : "-"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.studentShare != null ? rupee(r.studentShare) : "-"}</td>
                      <td className={cn("px-3 py-1.5 text-xs font-medium", TONE[r.outcome])}>{LABEL[r.outcome]}{r.note ? <span className="block font-normal text-muted-foreground">{r.note}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No current students in this course and batch.</p>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
