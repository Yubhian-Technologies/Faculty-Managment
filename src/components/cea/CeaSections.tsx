"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { whenLabel } from "@/lib/cea/rules";
import type { CeaMarksSheet, CeaWhen } from "@/types";

// CEA marks by section (HOD: their departments; Exam Cell / Principal / VP: all): each section's units - submitted,
// draft (entered so far) or not started - and any submitted sheet, read only.

type Row = { assignmentId: string; subjectCode: string; subjectName: string; department: string; section: string; facultyName: string; unitMarks: number;
  units: { unit: number; when: CeaWhen; sheetId: string; status: "DRAFT" | "SUBMITTED" | null; enteredCount: number; totalStudents: number; heldOn: string | null }[] };

export function CeaSections() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"" | "PENDING">("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/college/cea/sections").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Unable to load"); setRows(j.sections); }).catch((e: Error) => setError(e.message));
  }, []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!show || r.units.some((u) => u.status !== "SUBMITTED")) && (!s || `${r.subjectCode} ${r.subjectName} ${r.department} ${r.section} ${r.facultyName}`.toLowerCase().includes(s)));
  }, [rows, q, show]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!rows) return <div className="h-40 animate-pulse rounded-2xl bg-muted/40" />;
  const units = rows.flatMap((r) => r.units);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search" className="pl-8" placeholder="Subject, department, section, faculty" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Show" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
          <option value="">All sections</option><option value="PENDING">With units not submitted</option>
        </select>
        <span className="text-sm text-muted-foreground">{units.filter((u) => u.status === "SUBMITTED").length} of {units.length} unit sheets submitted</span>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No sections with a CIE plan.</p> : (
        <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">Subject</th><th className="px-3 py-2">Section</th><th className="px-3 py-2">Faculty</th><th className="px-3 py-2">Units</th></tr>
            </thead>
            <tbody>{list.map((r) => (
              <tr key={r.assignmentId} className="border-t">
                <td className="px-3 py-2"><div className="font-medium">{r.subjectName}</div><div className="font-mono text-xs text-muted-foreground">{r.subjectCode}</div></td>
                <td className="px-3 py-2">{r.department} · {r.section}</td>
                <td className="px-3 py-2">{r.facultyName || "-"}</td>
                <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{r.units.map((u) => (
                  <button key={u.unit} type="button" disabled={!u.status} onClick={() => setOpen(u.sheetId)} title={whenLabel(u.when)}
                    className={cn("rounded px-1.5 py-0.5 text-xs", u.status === "SUBMITTED" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200" : u.status ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : "bg-muted text-muted-foreground")}>
                    U{u.unit} {u.status === "SUBMITTED" ? "done" : u.status ? `${u.enteredCount}/${u.totalStudents}` : "-"}
                  </button>
                ))}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent></Card>
      )}
      {open && <SheetDialog sheetId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SheetDialog({ sheetId, onClose }: { sheetId: string; onClose: () => void }) {
  const [s, setS] = useState<CeaMarksSheet | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/college/cea/marks/${encodeURIComponent(sheetId)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Unable to load"); setS(j.sheet); }).catch((e: Error) => setError(e.message));
  }, [sheetId]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{s ? `${s.subjectName} - Unit ${s.unit}` : "CIE marks"}</DialogTitle>
          <DialogDescription>{s ? `${s.typeLabel} · ${whenLabel(s.when)} · ${s.department} Section ${s.sectionName} · ${s.facultyName} · ${s.status === "SUBMITTED" ? "submitted" : "draft"}${s.heldOn ? ` · held ${s.heldOn}` : ""}` : error || "Loading..."}</DialogDescription>
        </DialogHeader>
        {s && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">S.No</th><th className="py-1 pr-2">Regd. No</th><th className="py-1 pr-2">Name</th><th className="py-1 text-right">Marks / {s.unitMarks}</th></tr></thead>
            <tbody>{s.entries.map((e, i) => (
              <tr key={e.studentId} className="border-t">
                <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td><td className="py-1.5 pr-2">{e.rollNumber || "-"}</td><td className="py-1.5 pr-2">{e.name}</td>
                <td className="py-1.5 text-right tabular-nums">{e.absent ? "Absent" : e.marks ?? "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
