"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, GraduationCap, Users, Upload, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import { parseExcelFile, parseCSV, matchHeaders, readFileAsText } from "@/lib/utils/csv";
import type { AcademicYear, Section, StudentRecord } from "@/types";

const GRADUATE = "GRADUATE" as const;

// Allotment-file columns — a counseling/branch-allotment export can drive the
// same per-student target selection the manual table below sets by hand.
const ALLOTMENT_COLUMNS = [
  { key: "rollNumber", label: "Roll Number", required: true, aliases: ["Roll No", "Roll No.", "Roll Num"] },
  { key: "department", label: "Department", required: true, aliases: ["Dept", "Branch", "Target Department", "Allotted Branch", "Allotted Department"] },
  { key: "section", label: "Section", required: true, aliases: ["Target Section"] },
];

type AllotmentSummary = { matched: number; unmatched: { rollNumber: string; reason: string }[] };

export default function StudentPromotionsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [openYears, setOpenYears] = useState<AcademicYear[]>([]);
  const [isLoadingContext, setIsLoadingContext] = useState(true);

  const [sourceSectionId, setSourceSectionId] = useState<string>("");
  const [roster, setRoster] = useState<StudentRecord[]>([]);
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);

  const [targetSections, setTargetSections] = useState<Section[]>([]);
  const [defaultTarget, setDefaultTarget] = useState<string>(""); // section id, or GRADUATE
  const [rowTargets, setRowTargets] = useState<Record<string, string>>({}); // studentId -> section id | GRADUATE
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const allotmentFileRef = useRef<HTMLInputElement>(null);
  const [allotmentError, setAllotmentError] = useState("");
  const [allotmentSummary, setAllotmentSummary] = useState<AllotmentSummary | null>(null);

  useEffect(() => {
    setIsLoadingContext(true);
    Promise.all([
      fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: Section[] }>).then((d) => d.sections ?? []),
      fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears: AcademicYear[] }>).then((d) => (d.academicYears ?? []).filter((y) => y.isActive)),
    ])
      .then(([sections, years]) => {
        setSections(sections);
        setOpenYears(years);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load sections" }))
      .finally(() => setIsLoadingContext(false));
  }, []);

  const sourceSection = sections.find((s) => s.id === sourceSectionId) ?? null;
  const maxActiveYear = openYears.length > 0 ? Math.max(...openYears.map((y) => y.yearNumber)) : 4;
  const nextYear = sourceSection ? sourceSection.year + 1 : null;
  const isFinalYear = sourceSection ? sourceSection.year >= maxActiveYear : false;

  useEffect(() => {
    if (!sourceSection) {
      setRoster([]);
      return;
    }
    setIsLoadingRoster(true);
    fetch(`/api/college/students?section=${encodeURIComponent(sourceSection.name)}&year=${sourceSection.year}`)
      .then((r) => r.json() as Promise<{ students: StudentRecord[] }>)
      .then((d) => {
        // The students API scopes by section NAME + year only; narrow to this
        // exact section's department client-side since section names aren't
        // unique across departments.
        const filtered = (d.students ?? []).filter((s) => s.department === sourceSection.department);
        setRoster(filtered);
        const initialSelected: Record<string, boolean> = {};
        for (const s of filtered) initialSelected[s.id] = s.status === "REGULAR";
        setSelected(initialSelected);
        setRowTargets({});
        setAllotmentSummary(null);
        setAllotmentError("");
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load roster" }))
      .finally(() => setIsLoadingRoster(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSectionId]);

  useEffect(() => {
    if (!sourceSection || isFinalYear) {
      setTargetSections([]);
      setDefaultTarget(GRADUATE);
      return;
    }
    fetch(`/api/college/sections?year=${nextYear}`)
      .then((r) => r.json() as Promise<{ sections: Section[] }>)
      .then((d) => setTargetSections(d.sections ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load target sections" }));
    setDefaultTarget("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSectionId, isFinalYear]);

  // Auto-fill targets for students who pre-registered a core branch while
  // sitting under a different (e.g. Basic Science) primary department —
  // secondaryDepartment already names where they're headed, so there's no
  // need to make anyone pick it by hand or upload a file for these rows.
  // Only fills targets that are still empty, so it never overwrites a manual
  // pick or a prior allotment-file match.
  useEffect(() => {
    if (roster.length === 0 || targetSections.length === 0) return;

    const newTargets: Record<string, string> = {};
    const newSelected: Record<string, boolean> = {};

    for (const s of roster) {
      if (rowTargets[s.id]) continue;
      if (s.status !== "REGULAR") continue;
      if (!s.secondaryDepartment) continue;
      const matches = targetSections.filter(
        (t) => t.department.trim().toLowerCase() === s.secondaryDepartment!.trim().toLowerCase()
      );
      // Only auto-fill when unambiguous — if the registered department has
      // multiple next-year sections, leave it for the manual dropdown or an
      // allotment file that names the specific section.
      if (matches.length === 1) {
        newTargets[s.id] = matches[0].id;
        newSelected[s.id] = true;
      }
    }

    if (Object.keys(newTargets).length > 0) {
      setRowTargets((prev) => ({ ...prev, ...newTargets }));
      setSelected((prev) => ({ ...prev, ...newSelected }));
      const n = Object.keys(newTargets).length;
      toast({ variant: "success", title: `${n} student target${n !== 1 ? "s" : ""} auto-filled from their registered department` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, targetSections]);

  function applyDefaultToAll(target: string) {
    setDefaultTarget(target);
    const next: Record<string, string> = {};
    for (const s of roster) next[s.id] = target;
    setRowTargets(next);
  }

  async function handleAllotmentFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAllotmentError("");
    setAllotmentSummary(null);

    const name = file.name.toLowerCase();
    const isExcel = name.endsWith(".xlsx");
    if (name.endsWith(".xls")) {
      setAllotmentError("Legacy .xls files aren't supported — please re-save as .xlsx or .csv and try again.");
      e.target.value = "";
      return;
    }

    try {
      const parsed = isExcel ? await parseExcelFile(file) : parseCSV(await readFileAsText(file));
      if (parsed.length < 2) { setAllotmentError("File must have a header row and at least one data row."); return; }

      const headers = parsed[0].map((h) => h.trim());
      const keyMap = matchHeaders(headers, ALLOTMENT_COLUMNS);
      if (Object.keys(keyMap).length < 2) {
        setAllotmentError('Couldn\'t match the header row — make sure it has "Roll Number", "Department", and "Section" columns.');
        return;
      }

      const dataRows = parsed.slice(1).map((cells) => {
        const row: Record<string, string> = {};
        cells.forEach((val, i) => { if (keyMap[i]) row[keyMap[i]] = val; });
        return row;
      }).filter((r) => Object.values(r).some((v) => v.trim()));

      if (dataRows.length === 0) {
        setAllotmentError("No data rows found after the header.");
        return;
      }

      const rosterByRoll = new Map(roster.map((s) => [s.rollNumber.trim().toLowerCase(), s]));
      const targetByKey = new Map(
        targetSections.map((s) => [`${s.department.trim().toLowerCase()}::${s.name.trim().toLowerCase()}`, s])
      );

      let matchedCount = 0;
      const unmatched: { rollNumber: string; reason: string }[] = [];
      const newTargets: Record<string, string> = {};
      const newSelected: Record<string, boolean> = {};

      for (const row of dataRows) {
        const roll = (row.rollNumber ?? "").trim();
        if (!roll) continue;

        const student = rosterByRoll.get(roll.toLowerCase());
        if (!student) { unmatched.push({ rollNumber: roll, reason: "Roll number not found in this section's roster" }); continue; }
        if (student.status !== "REGULAR") { unmatched.push({ rollNumber: roll, reason: "Student is not REGULAR status" }); continue; }

        const targetKey = `${(row.department ?? "").trim().toLowerCase()}::${(row.section ?? "").trim().toLowerCase()}`;
        const target = targetByKey.get(targetKey);
        if (!target) {
          unmatched.push({
            rollNumber: roll,
            reason: `No "${row.department || "?"} — Section ${row.section || "?"}" section found for ${nextYear != null ? yearOrdinalLabel(nextYear) : "next year"}`,
          });
          continue;
        }

        newTargets[student.id] = target.id;
        newSelected[student.id] = true;
        matchedCount++;
      }

      setRowTargets((prev) => ({ ...prev, ...newTargets }));
      setSelected((prev) => ({ ...prev, ...newSelected }));
      setAllotmentSummary({ matched: matchedCount, unmatched });
      if (matchedCount > 0) {
        toast({ variant: "success", title: `${matchedCount} student target${matchedCount !== 1 ? "s" : ""} filled in from the allotment file` });
      }
    } catch {
      setAllotmentError(isExcel ? "Failed to parse the Excel file. Ensure it is a valid, uncorrupted .xlsx file." : "Failed to parse the file. Ensure it is a valid CSV.");
    } finally {
      e.target.value = "";
    }
  }

  function targetLabel(sectionId: string): string {
    const sec = targetSections.find((s) => s.id === sectionId);
    return sec ? `${sec.department} — Section ${sec.name}` : sectionId;
  }

  const regularCount = roster.filter((s) => s.status === "REGULAR").length;
  const selectedCount = useMemo(() => roster.filter((s) => selected[s.id]).length, [roster, selected]);

  async function handleSubmit() {
    const toPromote = roster.filter((s) => selected[s.id] && s.status === "REGULAR");
    if (toPromote.length === 0) {
      toast({ variant: "destructive", title: "Select at least one student" });
      return;
    }
    if (toPromote.some((s) => !rowTargets[s.id])) {
      toast({ variant: "destructive", title: "Every selected student needs a target (or Graduate)" });
      return;
    }

    setIsSubmitting(true);
    try {
      const groups: Record<string, string[]> = {};
      for (const s of toPromote) {
        const target = rowTargets[s.id];
        (groups[target] ??= []).push(s.id);
      }

      const results = await Promise.all(
        Object.entries(groups).map(([target, studentIds]) =>
          fetch("/api/college/students/promote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              target === GRADUATE
                ? { studentIds, action: "GRADUATE" }
                : { studentIds, action: "PROMOTE", targetSectionId: target }
            ),
          })
        )
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast({ variant: "destructive", title: `${failed.length} group(s) failed — check roster and retry` });
      } else {
        toast({ variant: "success", title: `${toPromote.length} student(s) updated` });
      }

      // Reload roster for this section (promoted students will now be gone)
      const refreshed = await fetch(`/api/college/students?section=${encodeURIComponent(sourceSection!.name)}&year=${sourceSection!.year}`)
        .then((r) => r.json() as Promise<{ students: StudentRecord[] }>);
      setRoster((refreshed.students ?? []).filter((s) => s.department === sourceSection!.department));
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Promotion"
        description="Move a cohort to the next year — bulk by section, with per-student override for students splitting into different departments"
      />

      <Card>
        <CardContent className="p-5 space-y-2">
          <label className="text-sm font-medium">Source Section</label>
          <Select value={sourceSectionId} onValueChange={setSourceSectionId} disabled={isLoadingContext}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Choose the section/cohort to promote" />
            </SelectTrigger>
            <SelectContent>
              {sections
                .slice()
                .sort((a, b) => a.year - b.year || a.department.localeCompare(b.department) || a.name.localeCompare(b.name))
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.department || "(no department)"} — Section {s.name} · {yearOrdinalLabel(s.year)} ({s.batch})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {sourceSection && (
        <>
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ArrowRight className="h-4 w-4" />
                {isFinalYear ? (
                  <span>This is the final year offered — students will be marked <strong>Graduated</strong>.</span>
                ) : (
                  <span>Default target for {nextYear != null ? yearOrdinalLabel(nextYear) : ""}:</span>
                )}
              </div>
              {!isFinalYear && (
                <Select value={defaultTarget} onValueChange={applyDefaultToAll}>
                  <SelectTrigger className="max-w-md">
                    <SelectValue placeholder="Select a default target section" />
                  </SelectTrigger>
                  <SelectContent>
                    {targetSections.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No sections exist yet for {nextYear != null ? yearOrdinalLabel(nextYear) : ""}</div>
                    ) : (
                      targetSections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.department || "(no department)"} — Section {s.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {!isFinalYear && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-medium">Or upload an allotment file</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      A file with Roll Number, Department, and Section columns (e.g. a counseling/branch-allotment
                      export) fills in the per-student targets below automatically — for cohorts splitting into
                      several departments at once, like 1st year Basic Sciences students moving into their allotted branch.
                    </p>
                  </div>
                  <input ref={allotmentFileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void handleAllotmentFile(e)} />
                  <Button variant="outline" size="sm" onClick={() => allotmentFileRef.current?.click()} className="shrink-0">
                    <Upload className="h-4 w-4 mr-1.5" />
                    Upload File
                  </Button>
                </div>

                {allotmentError && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    {allotmentError}
                  </div>
                )}

                {allotmentSummary && (
                  <div className="space-y-2">
                    <p className="text-sm flex items-center gap-1.5">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                      <strong>{allotmentSummary.matched}</strong> target{allotmentSummary.matched !== 1 ? "s" : ""} filled in
                      {allotmentSummary.unmatched.length > 0 && (
                        <span className="text-muted-foreground"> · {allotmentSummary.unmatched.length} row{allotmentSummary.unmatched.length !== 1 ? "s" : ""} skipped</span>
                      )}
                    </p>
                    {allotmentSummary.unmatched.length > 0 && (
                      <div className="rounded-lg border divide-y max-h-40 overflow-y-auto">
                        {allotmentSummary.unmatched.map((u, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                            <span className="text-muted-foreground font-mono">{u.rollNumber}</span>
                            <span className="text-red-600">{u.reason}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span><strong>{regularCount}</strong> regular students · <strong>{selectedCount}</strong> selected</span>
                </div>
                <Button onClick={() => void handleSubmit()} loading={isSubmitting} disabled={selectedCount === 0}>
                  <GraduationCap className="h-4 w-4 mr-2" />
                  {isFinalYear ? "Graduate Selected" : "Promote Selected"}
                </Button>
              </div>

              {isLoadingRoster ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
              ) : roster.length === 0 ? (
                <EmptyState title="No students in this section" icon={<Users className="h-8 w-8" />} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left w-10" />
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Roll No.</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Target</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {roster.map((s) => (
                        <tr key={s.id} className={s.status !== "REGULAR" ? "opacity-50" : ""}>
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={!!selected[s.id]}
                              disabled={s.status !== "REGULAR"}
                              onCheckedChange={(checked) => setSelected((prev) => ({ ...prev, [s.id]: !!checked }))}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono">{s.rollNumber}</td>
                          <td className="px-3 py-2">{s.name}</td>
                          <td className="px-3 py-2">
                            <Badge variant={s.status === "REGULAR" ? "default" : "secondary"} className="text-xs">
                              {s.status === "REGULAR" ? "Regular" : s.status === "DETAINED" ? "Detained" : "Graduated"}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            {isFinalYear ? (
                              <span className="text-xs text-muted-foreground">Graduate</span>
                            ) : (
                              <Select
                                value={rowTargets[s.id] ?? ""}
                                onValueChange={(v) => setRowTargets((prev) => ({ ...prev, [s.id]: v }))}
                                disabled={s.status !== "REGULAR"}
                              >
                                <SelectTrigger className="h-8 w-56">
                                  <SelectValue placeholder="Select target section" />
                                </SelectTrigger>
                                <SelectContent>
                                  {targetSections.map((sec) => (
                                    <SelectItem key={sec.id} value={sec.id}>{targetLabel(sec.id)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
