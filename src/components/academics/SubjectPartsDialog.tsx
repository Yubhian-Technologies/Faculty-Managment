"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { unitListLabel, type PartKey, type SubjectPart } from "@/lib/subjects/parts";

// Academics: a subject taught in two parts by two departments (e.g. BEEE - Electrical units 1-3 by EEE,
// Electronics units 4-6 by ECE). Top: the two parts. Below: every section teaching it now - which part it takes
// first (Mid 1 covers that part, Mid 2 the other) and which part each faculty member teaches.

type Faculty = { assignmentId: string; facultyName: string; department: string; part: PartKey | null };
type Section = { sectionId: string; sectionName: string; department: string; year: number | null; first: PartKey; faculty: Faculty[] };
type Data = { subject: { id: string; name: string; code: string }; parts: SubjectPart[] | null; syllabusUnits: number | null; sections: Section[] };
type PartForm = { name: string; units: string; departmentId: string };

const SELECT = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const emptyParts = (): PartForm[] => [{ name: "", units: "", departmentId: "" }, { name: "", units: "", departmentId: "" }];

export function SubjectPartsDialog({ subjectId, departments, onClose, onSaved }: {
  subjectId: string | null;
  departments: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<PartForm[]>(emptyParts());
  const [first, setFirst] = useState<Record<string, PartKey>>({});
  const [facultyPart, setFacultyPart] = useState<Record<string, PartKey | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (id: string) => {
    setData(null); setError("");
    const r = await fetch(`/api/college/subjects/${id}/parts`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Unable to load the subject's parts."); return; }
    const d = j as Data;
    setData(d);
    setForm(d.parts ? d.parts.map((p) => ({ name: p.name, units: unitListLabel(p.units), departmentId: p.departmentId })) : emptyParts());
    setFirst(Object.fromEntries(d.sections.map((s) => [s.sectionId, s.first])));
    setFacultyPart(Object.fromEntries(d.sections.flatMap((s) => s.faculty.map((f) => [f.assignmentId, f.part]))));
  }, []);

  useEffect(() => { if (subjectId) void load(subjectId); }, [subjectId, load]);

  async function saveParts(off = false) {
    if (!subjectId) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/college/subjects/${subjectId}/parts`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: off ? null : form }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "Unable to save the parts."); return; }
      toast({ variant: "success", title: off ? "Subject no longer taught in parts." : "Parts saved." });
      onSaved();
      await load(subjectId);
    } finally { setBusy(false); }
  }

  async function savePlan() {
    if (!subjectId || !data) return;
    const changedFirst = Object.fromEntries(data.sections.filter((s) => first[s.sectionId] !== s.first).map((s) => [s.sectionId, first[s.sectionId]]));
    const changedFaculty = Object.fromEntries(data.sections.flatMap((s) => s.faculty).filter((f) => (facultyPart[f.assignmentId] ?? null) !== f.part).map((f) => [f.assignmentId, facultyPart[f.assignmentId] ?? null]));
    if (!Object.keys(changedFirst).length && !Object.keys(changedFaculty).length) { toast({ title: "Nothing changed." }); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/college/subjects/${subjectId}/parts`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first: changedFirst, assignmentParts: changedFaculty }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "Unable to save the order."); return; }
      toast({ variant: "success", title: "Order and faculty parts saved." });
      await load(subjectId);
    } finally { setBusy(false); }
  }

  const parts = data?.parts ?? null;
  const partName = (k: PartKey) => parts?.find((p) => p.key === k)?.name ?? `Part ${k}`;
  const missingFaculty = data?.sections.reduce((n, s) => n + s.faculty.filter((f) => !facultyPart[f.assignmentId]).length, 0) ?? 0;

  return (
    <Dialog open={!!subjectId} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Taught in Parts{data ? ` - ${data.subject.code} ${data.subject.name}` : ""}</DialogTitle>
        </DialogHeader>
        {!data && !error && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        {data && (
          <div className="space-y-6">
            <section className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Two departments teach this subject, each its own units (for example Electrical units 1-3 by EEE, Electronics units 4-6 by ECE).
                Each section&apos;s Mid 1 covers the part it is taught first, and Mid 2 the other. The two departments become the Subject Departments.
                {data.syllabusUnits ? ` The frozen syllabus has ${data.syllabusUnits} units - the parts must cover all of them.` : ""}
              </p>
              {form.map((p, i) => (
                <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_8rem_1.4fr]">
                  <div className="space-y-1">
                    <Label>Part {i === 0 ? "A" : "B"} Name</Label>
                    <Input value={p.name} placeholder={i === 0 ? "Electrical" : "Electronics"} onChange={(e) => setForm((f) => f.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Units</Label>
                    <Input value={p.units} placeholder={i === 0 ? "1-3" : "4-6"} onChange={(e) => setForm((f) => f.map((x, j) => (j === i ? { ...x, units: e.target.value } : x)))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Department</Label>
                    <select className={SELECT} value={p.departmentId} onChange={(e) => setForm((f) => f.map((x, j) => (j === i ? { ...x, departmentId: e.target.value } : x)))}>
                      <option value="">Select a department</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void saveParts()}>{parts ? "Save Parts" : "Teach in Parts"}</Button>
                {parts && <Button variant="outline" disabled={busy} onClick={() => void saveParts(true)}>Stop Teaching in Parts</Button>}
              </div>
            </section>

            {parts && (
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Order and Faculty by Section</h3>
                  <p className="text-sm text-muted-foreground">
                    Pick the part each section is taught first, and the part each faculty member teaches.
                    {missingFaculty > 0 && ` ${missingFaculty} faculty row${missingFaculty === 1 ? " has" : "s have"} no part yet.`}
                  </p>
                </div>
                {data.sections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No section has a teaching assignment for this subject yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr><th className="px-3 py-2">Section</th><th className="px-3 py-2">Taught First</th><th className="px-3 py-2">Mid 1 / Mid 2</th><th className="px-3 py-2">Faculty and Part</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.sections.map((s) => {
                          const f = first[s.sectionId] ?? "A";
                          return (
                            <tr key={s.sectionId} className="align-top">
                              <td className="px-3 py-2 font-medium whitespace-nowrap">{s.sectionName}</td>
                              <td className="px-3 py-2">
                                <select aria-label={`Part taught first in ${s.sectionName}`} className="h-8 rounded-md border bg-background px-2 text-sm" value={f} onChange={(e) => setFirst((m) => ({ ...m, [s.sectionId]: e.target.value as PartKey }))}>
                                  {parts.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{partName(f)} / {partName(f === "A" ? "B" : "A")}</td>
                              <td className="px-3 py-2">
                                <div className="space-y-1">
                                  {s.faculty.map((x) => (
                                    <div key={x.assignmentId} className="flex flex-wrap items-center gap-2">
                                      <span className="min-w-40">{x.facultyName}</span>
                                      <select aria-label={`Part taught by ${x.facultyName} in ${s.sectionName}`} className="h-8 rounded-md border bg-background px-2 text-sm" value={facultyPart[x.assignmentId] ?? ""} onChange={(e) => setFacultyPart((m) => ({ ...m, [x.assignmentId]: (e.target.value || null) as PartKey | null }))}>
                                        <option value="">Not set</option>
                                        {parts.map((p) => <option key={p.key} value={p.key}>{p.name} (units {unitListLabel(p.units)})</option>)}
                                      </select>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Close</Button>
          {parts && data && data.sections.length > 0 && <Button disabled={busy} onClick={() => void savePlan()}>Save Order and Faculty</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
