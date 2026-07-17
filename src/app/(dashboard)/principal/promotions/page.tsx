"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GraduationCap, Users } from "lucide-react";
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
import type { AcademicYear, Section, StudentRecord } from "@/types";

const GRADUATE = "GRADUATE" as const;

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

  function applyDefaultToAll(target: string) {
    setDefaultTarget(target);
    const next: Record<string, string> = {};
    for (const s of roster) next[s.id] = target;
    setRowTargets(next);
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
