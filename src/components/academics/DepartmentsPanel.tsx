"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, CheckCircle2, Upload, Layers, ArrowLeft, ChevronRight, MoveRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FreshmanDepartmentBadge } from "@/components/shared/FreshmanDepartmentBadge";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import { resolveDepartmentCourseScope, type DepartmentWithId } from "@/lib/college/academicStructure";
import { RoleAssignmentsPage } from "@/components/roles/RoleAssignmentsPage";
import { SectionCard } from "@/components/academics/SectionsPanel";
import { SectionRoster } from "@/components/academics/SectionRoster";
import { sectionsOfDepartment, isFiledUnderDepartment } from "@/lib/departments/departmentSections";
import { isContainerDepartment } from "@/lib/departments/departmentTree";
import type { Course, Department, Section } from "@/types";

type DeptWithMaybeId = Department & { id: string };

// Every core department a manager is linked to, by either acceptable
// mechanism (migrateManagedBranchSubjects.ts's own `declaredElsewhere`
// check): `managedDepartments` (HOD-set, parent/child shape - VIT) or
// `secondaryDepartments`/`courseScopes[*].secondaryDepartments`
// (Principal-set, standalone shape - SVECW). Lets "Move subjects to core
// depts" surface for either shape instead of only the first.
function linkedBranchNames(dept: Department): string[] {
  return Array.from(new Set([
    ...(dept.managedDepartments ?? []),
    ...(dept.secondaryDepartments ?? []),
    ...Object.values(dept.courseScopes ?? {}).flatMap((s) => s.secondaryDepartments ?? []),
  ]));
}

interface SectionMoveDetail {
  sectionId: string;
  sectionName: string;
  fromSectionName: string;
  year: number;
  studentCount: number;
  fromDepartmentName: string;
  toDepartmentName: string;
}

interface SkippedSectionDetail {
  sectionName: string;
  year: number;
  reason: string;
}

interface CurrentSubjectDetail {
  subjectId: string;
  code: string;
  name: string;
  semester: number;
  year?: number;
}

interface MigrationCounts {
  sectionsRenamed: number;
  sectionsSkippedConflict: number;
  studentsMoved: number;
  subjectAssignmentsMoved: number;
  subjectAssignmentsDeduped: number;
  teachingAssignmentsRepointed: number;
  timetableSlotsRepointed: number;
  courseIdsRepaired: number;
  courseIdsUnresolved: number;
  secondaryDepartmentNamesCleared: number;
  sectionsRenamedInPlace: number;
  sections: SectionMoveDetail[];
  skippedSections: SkippedSectionDetail[];
  currentSubjects: CurrentSubjectDetail[];
}

type PreviewEntry = ({ ok: true } & MigrationCounts) | { ok: false; error: string };

async function callMigrateRoute(subDepartmentId: string, branchDepartmentId: string, dryRun: boolean): Promise<MigrationCounts> {
  const res = await fetch("/api/college/departments/migrate-managed-branch-subjects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subDepartmentId, branchDepartmentId, dryRun }),
  });
  const json = await res.json() as MigrationCounts & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed");
  return json;
}

// Step 1: pick which of the sub-department's managed core departments to
// move - a small modal, selection only. "Review" hands off to the full-page
// breakdown below rather than previewing inline.
function MigrationBranchPicker({ open, onOpenChange, subDepartment, branches, onReview }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subDepartment: DeptWithMaybeId;
  branches: { id: string; name: string }[];
  onReview: (branchIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set(branches.map((b) => b.id)));
  }, [open, branches]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move subjects &amp; students to core departments</DialogTitle>
          <DialogDescription>
            Moves &quot;{subDepartment.name}&quot;&apos;s sections, students, subjects, and timetable rows into each
            selected core department directly. Review before anything is written.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {branches.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(b.id)}
                onCheckedChange={(checked) => setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(b.id); else next.delete(b.id);
                  return next;
                })}
              />
              <span>{b.name}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={selected.size === 0} onClick={() => onReview(branches.filter((b) => selected.has(b.id)).map((b) => b.id))}>
            Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Small Previous/Next pager, same pattern already used by SubjectsMasterTable -
// reused here rather than reinvented, for the two "current state" tables below.
function PageControls({ page, setPage, totalItems, pageSize }: {
  page: number; setPage: (p: number) => void; totalItems: number; pageSize: number;
}) {
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-1">
      <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

const REVIEW_PAGE_SIZE = 10;

// Step 2: the detailed review page - a left/right split. LEFT is today's
// state (the manager's own current sections and subjects, paginated tables -
// nothing here changes until Confirm). RIGHT is what happens after: renamed
// sections, which department students land in, and which subjects move.
// Full-page, not a modal, so a Principal reviewing hundreds of students
// across several branches has room to read it.
function MigrationReviewPage({ subDepartment, branchIds, allBranches, collegeSections, onBack, onDone }: {
  subDepartment: DeptWithMaybeId;
  branchIds: string[];
  allBranches: { id: string; name: string }[];
  /** Every section in the college, already loaded by the caller - filtered here to this manager's own current ones. */
  collegeSections: Section[];
  onBack: () => void;
  onDone: () => void;
}) {
  const branches = useMemo(() => allBranches.filter((b) => branchIds.includes(b.id)), [allBranches, branchIds]);
  const [preview, setPreview] = useState<Record<string, PreviewEntry> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [currentSectionsPage, setCurrentSectionsPage] = useState(0);
  const [currentSubjectsPage, setCurrentSubjectsPage] = useState(0);
  // Per-branch page cursor for the "which subjects land here" table on the
  // right - keyed by branch id since each department's card paginates on
  // its own, independent of the others.
  const [branchSubjectsPage, setBranchSubjectsPage] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void (async () => {
      const entries = await Promise.all(branches.map(async (b): Promise<[string, PreviewEntry]> => {
        try {
          const counts = await callMigrateRoute(subDepartment.id, b.id, true);
          return [b.id, { ok: true, ...counts }];
        } catch (err) {
          return [b.id, { ok: false, error: err instanceof Error ? err.message : "Failed" }];
        }
      }));
      if (!cancelled) {
        setPreview(Object.fromEntries(entries));
        setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [subDepartment.id, branches]);

  async function confirmMove() {
    setIsConfirming(true);
    try {
      const results = await Promise.allSettled(branches.map((b) => callMigrateRoute(subDepartment.id, b.id, false).then(() => b.name)));
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - succeeded;
      toast({
        variant: failed === 0 ? "success" : "destructive",
        title: failed === 0 ? `Moved subjects & students for ${succeeded} department${succeeded !== 1 ? "s" : ""}` : `${succeeded} moved, ${failed} failed`,
        description: failed > 0
          ? results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.message ?? "Failed").join("; ")
          : undefined,
      });
      if (succeeded > 0) onDone();
    } finally {
      setIsConfirming(false);
    }
  }

  const okPreviews = Object.values(preview ?? {}).filter((p): p is { ok: true } & MigrationCounts => p.ok);
  const allMovingSections = okPreviews.flatMap((p) => p.sections);
  const allSkipped = okPreviews.flatMap((p) => p.skippedSections);
  const totalStudents = allMovingSections.reduce((n, s) => n + s.studentCount, 0);
  const totalSubjects = okPreviews.reduce((n, p) => n + p.subjectAssignmentsMoved, 0);
  const totalSubjectsDeduped = okPreviews.reduce((n, p) => n + p.subjectAssignmentsDeduped, 0);
  const totalNamesCleared = okPreviews.reduce((n, p) => n + p.secondaryDepartmentNamesCleared, 0);
  const totalCourseIdsRepaired = okPreviews.reduce((n, p) => n + p.courseIdsRepaired, 0);
  const totalSectionsRenamedInPlace = okPreviews.reduce((n, p) => n + p.sectionsRenamedInPlace, 0);
  const hasAnyError = preview ? Object.values(preview).some((p) => !p.ok) : false;
  // Zero sections/moved/deduped doesn't mean zero work - a row already filed
  // directly under a core department can still carry a stale
  // secondaryDepartmentNames narrowing (leaking it into a sibling branch's
  // own Subjects view), a stale courseId from before that branch had its own
  // Course doc, or a section whose name never got trimmed to the branch's
  // own convention (both from before this tool's cleanup/rename logic
  // existed); confirming is what fixes those repair-only counts, so they
  // count as real pending work too. Only disable once every category - moves
  // AND in-place repairs - is actually empty.
  const nothingToMove = !isLoading && allMovingSections.length === 0 && totalSubjects === 0
    && totalSubjectsDeduped === 0 && totalNamesCleared === 0 && totalCourseIdsRepaired === 0
    && totalSectionsRenamedInPlace === 0;

  // LEFT panel: today's state. Two sources, combined:
  //  1. Sections still genuinely filed under the manager (live data from the
  //     caller's own section list).
  //  2. Sections the preview reports as "already moved, but students still
  //     waiting to catch up" (fromSectionName === sectionName - no rename
  //     happened because it already left the manager some other way). Without
  //     this second source, those students would look like they have no
  //     section at all, when they actually do - it just isn't filed under
  //     this department any more.
  const currentSections = useMemo(() => {
    const fromCollege = collegeSections.filter((s) => s.department === subDepartment.name);
    const seenIds = new Set(fromCollege.map((s) => s.id));
    const strayMap = new Map<string, { id: string; name: string; year: number; studentCount: number }>();
    for (const s of allMovingSections) {
      if (s.fromSectionName !== s.sectionName || seenIds.has(s.sectionId) || !s.sectionId) continue;
      strayMap.set(s.sectionId, { id: s.sectionId, name: s.sectionName, year: s.year, studentCount: s.studentCount });
    }
    return [...fromCollege, ...strayMap.values()].sort((a, b) => (a.year - b.year) || a.name.localeCompare(b.name));
  }, [collegeSections, subDepartment.name, allMovingSections]);
  const currentSubjects = okPreviews[0]?.currentSubjects ?? [];
  const currentSectionsPageRows = currentSections.slice(currentSectionsPage * REVIEW_PAGE_SIZE, (currentSectionsPage + 1) * REVIEW_PAGE_SIZE);
  const currentSubjectsPageRows = currentSubjects.slice(currentSubjectsPage * REVIEW_PAGE_SIZE, (currentSubjectsPage + 1) * REVIEW_PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title={`Review: move "${subDepartment.name}" into core departments`}
          description="Nothing is written to the database until you confirm below."
        />
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT: today's state - nothing here changes until Confirm. */}
        <div className="space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Current &middot; {subDepartment.name}
          </h2>
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium">Sections ({currentSections.length})</p>
              {currentSections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sections filed under this department.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="py-1.5 pr-4">Section</th>
                          <th className="py-1.5 pr-4">Year</th>
                          <th className="py-1.5">Students</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {currentSectionsPageRows.map((s) => (
                          <tr key={s.id}>
                            <td className="py-1.5 pr-4 font-medium">{s.name}</td>
                            <td className="py-1.5 pr-4">{yearOrdinalLabel(s.year)}</td>
                            <td className="py-1.5">{s.studentCount ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PageControls page={currentSectionsPage} setPage={setCurrentSectionsPage} totalItems={currentSections.length} pageSize={REVIEW_PAGE_SIZE} />
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium">
                Subjects ({isLoading ? "…" : currentSubjects.length})
              </p>
              {isLoading ? (
                <div className="h-20 rounded-md bg-muted/30 animate-pulse" />
              ) : currentSubjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No subjects assigned under this department.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="py-1.5 pr-4">Code</th>
                          <th className="py-1.5 pr-4">Name</th>
                          <th className="py-1.5">Sem</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {currentSubjectsPageRows.map((s) => (
                          <tr key={`${s.subjectId}-${s.semester}`}>
                            <td className="py-1.5 pr-4 font-mono text-xs">{s.code}</td>
                            <td className="py-1.5 pr-4">{s.name}</td>
                            <td className="py-1.5">{s.semester}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PageControls page={currentSubjectsPage} setPage={setCurrentSubjectsPage} totalItems={currentSubjects.length} pageSize={REVIEW_PAGE_SIZE} />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: what happens after Confirm - renamed sections, where
            students land, which department each subject moves to. */}
        <div className="space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">After migration</h2>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg border bg-muted/30 animate-pulse" />)}
            </div>
          ) : (
            <>
              {Object.entries(preview ?? {}).map(([branchId, p]) => {
                const branch = branches.find((b) => b.id === branchId);
                if (!p.ok) {
                  return (
                    <Card key={branchId}><CardContent className="p-4 text-sm text-destructive">{branch?.name}: {p.error}</CardContent></Card>
                  );
                }
                return (
                  <Card key={branchId}>
                    <CardContent className="p-4 space-y-3">
                      <h3 className="font-semibold text-sm">{branch?.name}</h3>
                      {p.sections.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No sections to move for this department.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              <tr>
                                <th className="py-1.5 pr-4">Section (before &rarr; after)</th>
                                <th className="py-1.5 pr-4">Year</th>
                                <th className="py-1.5 pr-4">Students</th>
                                <th className="py-1.5">Lands in</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {p.sections.map((s) => (
                                <tr key={s.sectionId}>
                                  <td className="py-1.5 pr-4 font-medium">
                                    {s.fromSectionName === s.sectionName
                                      ? s.sectionName
                                      : <>{s.fromSectionName} <span className="text-muted-foreground">&rarr;</span> {s.sectionName}</>}
                                  </td>
                                  <td className="py-1.5 pr-4">{yearOrdinalLabel(s.year)}</td>
                                  <td className="py-1.5 pr-4">{s.studentCount}</td>
                                  <td className="py-1.5 font-medium">{s.toDepartmentName}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {p.skippedSections.length > 0 && (
                        <p className="text-xs text-amber-600">
                          Skipped: {p.skippedSections.map((s) => `"${s.sectionName}" (${yearOrdinalLabel(s.year)}) - ${s.reason}`).join("; ")}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {p.teachingAssignmentsRepointed} teaching assignment{p.teachingAssignmentsRepointed !== 1 ? "s" : ""} and {p.timetableSlotsRepointed} timetable row{p.timetableSlotsRepointed !== 1 ? "s" : ""} repointed.
                        {p.courseIdsRepaired > 0 && ` ${p.courseIdsRepaired} subject${p.courseIdsRepaired !== 1 ? "s" : ""} here had a stale course link from an earlier run - fixed.`}
                        {p.secondaryDepartmentNamesCleared > 0 && ` ${p.secondaryDepartmentNamesCleared} subject${p.secondaryDepartmentNamesCleared !== 1 ? "s" : ""} had a leftover narrowing to another department - cleared.`}
                        {p.sectionsRenamedInPlace > 0 && ` ${p.sectionsRenamedInPlace} section${p.sectionsRenamedInPlace !== 1 ? "s" : ""} here still had the old naming from an earlier run - renamed to ${branch?.name}'s own convention.`}
                      </p>
                      {p.courseIdsUnresolved > 0 && (
                        <p className="text-xs text-amber-600">
                          {p.courseIdsUnresolved} subject{p.courseIdsUnresolved !== 1 ? "s" : ""} couldn&apos;t be linked to {branch?.name}&apos;s own Course yet -
                          it has no Course document for this programme. Create/open it under {branch?.name}&apos;s own Years Taught, then re-run this move to finish linking them.
                        </p>
                      )}

                      {/* Which subjects land in THIS department - the same
                          list as the left panel's "Current" subjects (the
                          tool moves every current subject to every selected
                          branch, nothing split per department), shown again
                          here under this branch's own name so it reads as
                          "X holds these subjects" rather than just a count. */}
                      <div className="pt-1 border-t">
                        <p className="text-sm font-medium pt-2">
                          {branch?.name} will hold ({p.subjectAssignmentsMoved + p.subjectAssignmentsDeduped} subject{(p.subjectAssignmentsMoved + p.subjectAssignmentsDeduped) !== 1 ? "s" : ""})
                          {p.subjectAssignmentsDeduped > 0 && <span className="text-muted-foreground font-normal"> - {p.subjectAssignmentsDeduped} already there, deduplicated</span>}
                        </p>
                        {currentSubjects.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No subjects to move.</p>
                        ) : (
                          (() => {
                            const branchPage = branchSubjectsPage[branch?.id ?? ""] ?? 0;
                            const rows = currentSubjects.slice(branchPage * REVIEW_PAGE_SIZE, (branchPage + 1) * REVIEW_PAGE_SIZE);
                            return (
                              <>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      <tr>
                                        <th className="py-1.5 pr-4">Code</th>
                                        <th className="py-1.5 pr-4">Name</th>
                                        <th className="py-1.5">Sem</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                      {rows.map((s) => (
                                        <tr key={`${branch?.id}-${s.subjectId}-${s.semester}`}>
                                          <td className="py-1.5 pr-4 font-mono text-xs">{s.code}</td>
                                          <td className="py-1.5 pr-4">{s.name}</td>
                                          <td className="py-1.5">{s.semester}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                <PageControls
                                  page={branchPage}
                                  setPage={(pg) => setBranchSubjectsPage((prev) => ({ ...prev, [branch?.id ?? ""]: pg }))}
                                  totalItems={currentSubjects.length}
                                  pageSize={REVIEW_PAGE_SIZE}
                                />
                              </>
                            );
                          })()
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              <Card className="bg-muted/30">
                <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">About the subjects</p>
                  <p>
                    Subjects aren&apos;t duplicated - they live once in the college&apos;s shared Subjects list (see the
                    current list on the left, {currentSubjects.length} subject{currentSubjects.length !== 1 ? "s" : ""}).
                    This moves the per-department link ({totalSubjects} row{totalSubjects !== 1 ? "s" : ""}) from
                    &quot;{subDepartment.name}&quot; to each selected core department - the same {currentSubjects.length} subjects
                    move to every department selected above, nothing is split between them.
                  </p>
                </CardContent>
              </Card>

              {!nothingToMove && (
                <p className="text-sm font-medium">
                  Total: {allMovingSections.length} section{allMovingSections.length !== 1 ? "s" : ""}, {totalStudents} student{totalStudents !== 1 ? "s" : ""}
                  {allSkipped.length > 0 ? `, ${allSkipped.length} section${allSkipped.length !== 1 ? "s" : ""} skipped` : ""} across {branches.length} department{branches.length !== 1 ? "s" : ""}.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" onClick={onBack}>Cancel</Button>
        <Button onClick={() => void confirmMove()} disabled={isLoading || isConfirming || nothingToMove || hasAnyError}>
          {isConfirming ? "Moving..." : "Confirm & Move"}
        </Button>
      </div>
    </div>
  );
}

/** Sections by year, ascending, each year's own list by name. */
function groupByYear(list: Section[]): [number, Section[]][] {
  const map = new Map<number, Section[]>();
  for (const s of list) map.set(s.year, [...(map.get(s.year) ?? []), s]);
  for (const group of map.values()) group.sort((a, b) => a.name.localeCompare(b.name));
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}

// In-place drill-down for one top-level department: sub-departments (if it has
// any) -> that sub-department's sections -> a section's student roster. All of
// it renders inside the Departments toggle - nothing navigates away.
//
// A department can have sub-departments AND run sections of its own (CSE ->
// Cyber Security, ECE -> VLSI). It then lists both: the sub-department cards and
// its own sections. Only a pure container (Basic Science: it organises
// sub-departments and nothing is filed under it) lists the cards alone.
function DepartmentDrillDown({ departments, courses, rootId, onExit }: {
  departments: Department[];
  courses: Course[];
  rootId: string;
  onExit: () => void;
}) {
  const router = useRouter();
  const [path, setPath] = useState<string[]>([rootId]);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pickerFor, setPickerFor] = useState<DeptWithMaybeId | null>(null);
  const [reviewRequest, setReviewRequest] = useState<{ subDept: DeptWithMaybeId; branchIds: string[] } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections?: Section[] }>);
        setSections(res.sections ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const byId = (id: string) => departments.find((d) => d.id === id);
  const current = byId(path[path.length - 1]);
  const children = current ? departments.filter((d) => d.parentDepartmentId === current.id) : [];
  // courseId -> catalogId: a manager's years are decided per course, so each section is resolved against its own course.
  const catalogIdByCourseId = useMemo(() => new Map(courses.map((c) => [c.id, c.catalogId])), [courses]);
  // What is filed directly under this department. For a container this is normally empty; it is
  // still listed when it isn't, so a section filed under a parent is never hidden by it having children.
  const filedHere = useMemo(
    () => (current ? sections.filter((s) => isFiledUnderDepartment(current as DeptWithMaybeId, s)) : []),
    [current, sections]
  );
  // `undefined` while sections load: nothing is guessed about a department until its sections are known.
  const isContainer = current ? isContainerDepartment(current, departments, isLoading ? undefined : filedHere.length > 0) : false;
  const deptSections = useMemo(() => {
    if (!current) return [];
    // A container keeps its old look (cards only); the direct-filed list is just the safety net above.
    if (children.length > 0 && isContainer) return filedHere;
    return sectionsOfDepartment(current as DeptWithMaybeId, departments, sections, catalogIdByCourseId);
  }, [current, departments, sections, catalogIdByCourseId, children.length, isContainer, filedHere]);
  const byYear = useMemo(() => {
    const map = new Map<number, Section[]>();
    for (const s of deptSections) map.set(s.year, [...(map.get(s.year) ?? []), s]);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [deptSections]);

  // Each sub-department's own sections, so the parent's page shows everything in
  // its tree rather than only what is filed directly under it. VWU's Computer
  // Science and Engineering runs 9 sections of its own and CSE [CYBER SECURITY]
  // another 3; all 12 belong on that page, each under the name of the
  // department that owns it. A sub-department owns its own years outright
  // (sectionsOfDepartment resolves the owner per year), so nothing is listed
  // twice.
  const childGroups = useMemo(() => {
    if (!current) return [];
    return departments
      .filter((d) => d.parentDepartmentId === current.id)
      .map((owner) => ({
        owner,
        byYear: groupByYear(sectionsOfDepartment(owner as DeptWithMaybeId, departments, sections, catalogIdByCourseId)),
      }))
      .filter((g) => g.byYear.length > 0);
  }, [current, departments, sections, catalogIdByCourseId]);

  if (!current) return null;
  if (openSectionId) {
    return <SectionRoster sectionId={openSectionId} onBack={() => setOpenSectionId(null)} backLabel={`Back to ${current.name}`} />;
  }
  if (reviewRequest) {
    return (
      <MigrationReviewPage
        subDepartment={reviewRequest.subDept}
        branchIds={reviewRequest.branchIds}
        allBranches={linkedBranchNames(reviewRequest.subDept)
          .map((name) => departments.find((d) => d.name === name) as DeptWithMaybeId | undefined)
          .filter((d): d is DeptWithMaybeId => !!d)
          .map((d) => ({ id: d.id, name: d.name }))}
        collegeSections={sections}
        onBack={() => setReviewRequest(null)}
        onDone={() => setReviewRequest(null)}
      />
    );
  }

  const goBack = () => (path.length > 1 ? setPath(path.slice(0, -1)) : onExit());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button className="text-muted-foreground hover:text-foreground" onClick={onExit}>Departments</button>
          {path.map((id, i) => (
            <span key={id} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                className={i === path.length - 1 ? "font-semibold" : "text-muted-foreground hover:text-foreground"}
                onClick={() => setPath(path.slice(0, i + 1))}
              >
                {byId(id)?.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          {/* Sub-department cards below (children.map) are navigation-only -
              nothing in this drill-down previously linked to the edit form,
              so a sub-department's name/code could never actually be
              changed once inside it. Mirrors the top-level grid's own Edit
              pencil (same /edit route, works for any department id). */}
          <Button variant="outline" size="sm" onClick={() => router.push(`/principal/departments/${current.id}/edit`)}>
            <Pencil className="h-4 w-4 mr-1" />Edit
          </Button>
          <Button variant="outline" size="sm" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
        </div>
      </div>

      <PageHeader
        title={current.name}
        description={
          children.length === 0
            ? "Select a section to see its students"
            : deptSections.length > 0
              ? "Open a sub-department, or one of this department's own sections"
              : "Select a sub-department to see its sections"
        }
      />

      {/* Standalone managers linked only via secondaryDepartments (SVECW's
          shape - no parentDepartmentId, so they never show up as anyone's
          child card below) still need a way to reach the migration -
          shown here when standing inside the manager itself. */}
      {linkedBranchNames(current).length > 0 && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Linked to {linkedBranchNames(current).join(", ")}.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPickerFor(current as DeptWithMaybeId)}
            >
              <MoveRight className="h-3.5 w-3.5 mr-1" />Move subjects to core depts
            </Button>
          </CardContent>
        </Card>
      )}

      {children.length > 0 && (
        <div className="space-y-3">
          {deptSections.length > 0 && <h2 className="font-semibold text-base">Sub-departments</h2>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((c) => (
              <Card key={c.id} className="cursor-pointer transition-colors hover:border-primary/50" onClick={() => setPath([...path, c.id])}>
                <CardContent className="p-4">
                  <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded bg-muted text-xs font-mono font-semibold text-muted-foreground mb-1">{c.code}</span>
                  <p className="font-semibold text-sm leading-tight">{c.name}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {c.hodName ? `HOD: ${c.hodName}` : "No HOD assigned"}
                  </p>
                  {linkedBranchNames(c).length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs mt-2 w-full"
                      onClick={(e) => { e.stopPropagation(); setPickerFor(c as DeptWithMaybeId); }}
                    >
                      <MoveRight className="h-3.5 w-3.5 mr-1" />Move subjects to core depts
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {children.length === 0 && isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : byYear.length === 0 ? (
        children.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No sections in this department yet.</CardContent></Card>
        ) : null
      ) : (
        <div className="space-y-8">
          {children.length > 0 && <h2 className="font-semibold text-base">{current.name} - own sections</h2>}
          {byYear.map(([year, list]) => (
            <div key={year}>
              <h3 className={children.length > 0 ? "font-semibold text-sm text-muted-foreground mb-3" : "font-semibold text-base mb-3"}>{yearOrdinalLabel(year)}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((sec) => <SectionCard key={sec.id} sec={sec} onOpen={() => setOpenSectionId(sec.id)} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Each sub-department's own sections, under its name. */}
      {childGroups.map(({ owner, byYear: childYears }) => (
        <div key={owner.id} className="space-y-8">
          <h2 className="font-semibold text-base">{owner.name} - own sections</h2>
          {childYears.map(([year, list]) => (
            <div key={year}>
              <h3 className="font-semibold text-sm text-muted-foreground mb-3">{yearOrdinalLabel(year)}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((sec) => <SectionCard key={sec.id} sec={sec} onOpen={() => setOpenSectionId(sec.id)} />)}
              </div>
            </div>
          ))}
        </div>
      ))}

      {pickerFor && (
        <MigrationBranchPicker
          open={!!pickerFor}
          onOpenChange={(open) => !open && setPickerFor(null)}
          subDepartment={pickerFor}
          branches={linkedBranchNames(pickerFor)
            .map((name) => departments.find((d) => d.name === name) as DeptWithMaybeId | undefined)
            .filter((d): d is DeptWithMaybeId => !!d)
            .map((d) => ({ id: d.id, name: d.name }))}
          onReview={(branchIds) => { setReviewRequest({ subDept: pickerFor, branchIds }); setPickerFor(null); }}
        />
      )}
    </div>
  );
}

export function DepartmentsPanel() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingDept, setDeletingDept] = useState<Department | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [showRoles, setShowRoles] = useState(false);

  // Only parents are listed here. A sub-department (e.g. BS-Chemistry under
  // Basic Science) is not a peer of its parent, so it would be misleading as a
  // top-level card - it's reached by opening the parent instead.
  const topLevelDepartments = departments.filter((d) => !d.parentDepartmentId);
  const childrenOf = (parentId: string) =>
    departments.filter((d) => d.parentDepartmentId === parentId);
  const coursesOf = (departmentId: string) =>
    courses.filter((c) => c.departmentId === departmentId).sort((a, b) => a.name.localeCompare(b.name));

  async function loadDepts() {
    setIsLoading(true);
    try {
      // No `departmentId` - a non-HOD caller gets every Course doc in the
      // college in one call, so each department's cards can show its own
      // courses' years/cross-listing instead of one blended department-wide
      // badge (a department can offer several courses with different
      // structures - see resolveDepartmentCourseScope).
      const [deptRes, coursesRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
      ]);
      setDepartments(deptRes.departments ?? []);
      setCourses(coursesRes.courses ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load departments" });
    } finally {
      setIsLoading(false);
    }
  }

  // Awaited in a wrapper so loadDepts()'s setState calls aren't reachable
  // synchronously from the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await loadDepts(); })();
  }, []);

  async function handleDelete(dept: Department) {
    try {
      const res = await fetch(`/api/college/departments?deptId=${encodeURIComponent(dept.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({ variant: "success", title: "Department removed" });
      setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
    } catch (err) {
      // The server refuses a delete that would orphan data and says exactly
      // what is in the way ("still has sub-departments", "still has students
      // or sections", ...). That message was being swallowed here, leaving
      // "Failed to remove department" with no way to tell what to clear first.
      toast({
        variant: "destructive",
        title: `Couldn't remove ${dept.name}`,
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setDeletingDept(null);
    }
  }

  // Role Assignments renders in place too; HODs may change there, so reload
  // the department cards on the way back.
  if (showRoles) {
    return (
      <div className="space-y-6">
        <Button variant="outline" size="sm" onClick={() => { setShowRoles(false); void loadDepts(); }}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back to Departments
        </Button>
        <RoleAssignmentsPage />
      </div>
    );
  }

  if (selectedDeptId) {
    return <DepartmentDrillDown departments={departments} courses={courses} rootId={selectedDeptId} onExit={() => setSelectedDeptId(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Manage college departments and assign Heads of Department"
        actions={
          <>
            <Button variant="outline" onClick={() => router.push("/principal/departments/import")}>
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button onClick={() => router.push("/principal/departments/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Add Department
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : topLevelDepartments.length === 0 ? (
        <Card>
          {/* No second "Add Department" button here - the page header already
              carries one, and on an empty page the two sat a few centimetres
              apart doing the same thing. The message points at the one above. */}
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">No departments yet. Use <span className="font-medium text-foreground">Add Department</span> above to create your first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topLevelDepartments.map((dept) => {
            const deptCourses = coursesOf(dept.id);
            const subDeptCount = childrenOf(dept.id).length;
            return (
              <Card
                key={dept.id}
                className={`flex flex-col cursor-pointer transition-colors hover:border-primary/50 ${!dept.isActive ? "opacity-60" : ""}`}
                onClick={() => setSelectedDeptId(dept.id)}
              >
                <CardContent className="flex flex-col flex-1 p-4">
                  {/* Header: code + actions */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-1.5 rounded bg-muted text-xs font-mono font-semibold text-muted-foreground">
                        {dept.code}
                      </span>
                      <FreshmanDepartmentBadge departmentId={dept.id} allDepartments={departments as DepartmentWithId[]} />
                      {!dept.isActive && <span className="text-[10px] font-medium text-orange-500 uppercase tracking-wide">Inactive</span>}
                    </div>
                    <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit department"
                        onClick={() => router.push(`/principal/departments/${dept.id}/edit`)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Delete department"
                        onClick={() => setDeletingDept(dept)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Name */}
                  <p className="font-semibold text-sm mt-2 leading-snug">{dept.name}</p>

                  {/* HOD */}
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                    {dept.hodName && dept.hodUid ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                        <p className="text-xs text-muted-foreground truncate">HOD: {dept.hodName}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-orange-500">No HOD assigned</p>
                    )}
                  </div>

                  {/* Course + Year info - concise text only */}
                  <div className="mt-2 space-y-1 flex-1">
                    {deptCourses.length > 0 ? (
                      deptCourses.map((c) => {
                        const scope = resolveDepartmentCourseScope(dept, c.catalogId);
                        const yearsText = scope.assignedYears.length > 0
                          ? scope.assignedYears.map(yearOrdinalLabel).join(", ")
                          : "No years assigned";
                        return (
                          <p key={c.id} className="text-xs text-muted-foreground line-clamp-1">
                            <span className="font-medium text-foreground">{c.name}:</span>{" "}{yearsText}
                          </p>
                        );
                      })
                    ) : dept.assignedYears && dept.assignedYears.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {dept.assignedYears.map(yearOrdinalLabel).join(", ")}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">No courses configured</p>
                    )}

                    {subDeptCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <Layers className="inline h-3 w-3 mr-1 -mt-px" />
                        {subDeptCount} sub-department{subDeptCount !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2 mt-3 pt-3 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-auto min-h-8 min-w-0 px-2 py-1.5 text-xs"
                    >
                      <Link href={`/principal/departments/${dept.id}`}>Manage courses &amp; timings</Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto min-h-8 min-w-0 px-2 py-1.5 text-xs"
                      onClick={() => setShowRoles(true)}
                    >
                      Role Assignments
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingDept}
        onOpenChange={(open) => !open && setDeletingDept(null)}
        title="Remove Department?"
        description={`"${deletingDept?.name}" will be removed. Existing vacancy requests and candidates linked to this department are NOT affected.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => { if (deletingDept) void handleDelete(deletingDept); }}
      />
    </div>
  );
}
