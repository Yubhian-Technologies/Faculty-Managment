"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Plus, GraduationCap, UserCog, Eye, Trash2, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import type { Section, Course, Department } from "@/types";

type SectionRow = Section & { id: string };

const YEAR_PALETTE = [
  "bg-purple-50 border-purple-200 text-purple-800",
  "bg-blue-50 border-blue-200 text-blue-800",
  "bg-emerald-50 border-emerald-200 text-emerald-800",
  "bg-amber-50 border-amber-200 text-amber-800",
  "bg-rose-50 border-rose-200 text-rose-800",
  "bg-cyan-50 border-cyan-200 text-cyan-800",
];
const YEAR_BADGE_PALETTE = [
  "bg-purple-100 text-purple-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];
function yearColor(year: number) { return YEAR_PALETTE[(year - 1) % YEAR_PALETTE.length]; }
function yearBadge(year: number) { return YEAR_BADGE_PALETTE[(year - 1) % YEAR_BADGE_PALETTE.length]; }
function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

const STUDENT_FACULTY_RATIO = 15;

export default function OfficeSectionsPage() {
  const router = useRouter();
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeDepartmentId, setActiveDepartmentId] = useState<string>("all");
  const [activeYear, setActiveYear] = useState<number | "all">("all");
  const [deleteTarget, setDeleteTarget] = useState<SectionRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sectionsRes, coursesRes, departmentsRes] = await Promise.all([
        fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: SectionRow[] }>),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
      ]);
      setSections(sectionsRes.sections ?? []);
      setCourses((coursesRes.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)));
      setDepartments((departmentsRes.departments ?? []).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      toast({ variant: "destructive", title: "Failed to load sections" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/sections/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete section");

      toast({ variant: "success", title: `Section ${deleteTarget.name} deleted` });
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete section" });
    } finally {
      setIsDeleting(false);
    }
  }

  function openCreate() {
    const params = new URLSearchParams();
    if (activeDepartmentId !== "all") params.set("departmentId", activeDepartmentId);
    const qs = params.toString();
    router.push(qs ? `/college-office/sections/new?${qs}` : "/college-office/sections/new");
  }

  const activeDepartment = activeDepartmentId !== "all" ? departments.find((d) => d.id === activeDepartmentId) ?? null : null;

  const sectionsInActiveDepartment = activeDepartment
    ? sections.filter((s) => s.department === activeDepartment.name)
    : sections;
  // Year tabs are data-driven (which years actually have sections), not
  // derived from a course's duration - there's no "the" course once the
  // course filter tier is gone from this list.
  const yearsAvailable = Array.from(new Set(sectionsInActiveDepartment.map((s) => s.year))).sort((a, b) => a - b);

  const filteredSections = sectionsInActiveDepartment.filter((s) => {
    if (activeYear !== "all" && s.year !== activeYear) return false;
    return true;
  });

  // Group by department, then by course + year within each department - kept
  // separate even when several departments share the same course, so a
  // shared first-year course doesn't clump every sub-department's sections
  // into one undifferentiated pile.
  type CourseYearGroup = { courseId: string; courseName: string; year: number; sections: SectionRow[] };
  type DeptGroup = { department: string; groups: CourseYearGroup[] };
  const deptGroups: DeptGroup[] = [];
  for (const s of filteredSections) {
    const deptName = s.department || "(no department)";
    let dg = deptGroups.find((x) => x.department === deptName);
    if (!dg) {
      dg = { department: deptName, groups: [] };
      deptGroups.push(dg);
    }
    let g = dg.groups.find((x) => x.courseId === s.courseId && x.year === s.year);
    if (!g) {
      g = { courseId: s.courseId, courseName: s.courseName ?? "Unknown Course", year: s.year, sections: [] };
      dg.groups.push(g);
    }
    g.sections.push(s);
  }
  deptGroups.sort((a, b) => a.department.localeCompare(b.department));
  for (const dg of deptGroups) {
    dg.groups.sort((a, b) => a.courseName.localeCompare(b.courseName) || a.year - b.year);
  }

  const totalStudents = sections.reduce((sum, s) => sum + (s.studentCount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sections"
        description="Class sections across every department - create sections and manage student rosters"
        actions={
          <div className="flex gap-2">
            {/* Import Students - temporarily hidden, not removed. Re-enable by
                uncommenting this button. */}
            {/* <Button variant="outline" asChild>
              <Link href="/college-office/students/import"><Upload className="h-4 w-4 mr-2" />Import Students</Link>
            </Button> */}
            <Button onClick={openCreate} disabled={courses.length === 0}>
              <Plus className="h-4 w-4 mr-2" />Add Section
            </Button>
          </div>
        }
      />

      {!isLoading && courses.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses have been set up yet. Ask the Principal to add courses under Departments before creating sections.
        </div>
      )}

      {/* Summary strip */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <GraduationCap className="h-4 w-4" />
          <span><strong className="text-foreground">{sections.length}</strong> sections</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-4 w-4" />
          <span><strong className="text-foreground">{totalStudents}</strong> students total</span>
        </div>
        {totalStudents > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <UserCog className="h-4 w-4" />
            <span>
              <strong className="text-foreground">{Math.ceil(totalStudents / STUDENT_FACULTY_RATIO)}</strong> faculty needed
              <span className="ml-1 text-xs">(1:{STUDENT_FACULTY_RATIO} ratio)</span>
            </span>
          </div>
        )}
      </div>

      {/* Department filter tabs */}
      {departments.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setActiveDepartmentId("all"); setActiveYear("all"); }}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              activeDepartmentId === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            All Departments
          </button>
          {departments.map((d) => (
            <button
              key={d.id}
              onClick={() => { setActiveDepartmentId(d.id); setActiveYear("all"); }}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeDepartmentId === d.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {/* Year filter tabs - data-driven from which years actually have sections */}
      {yearsAvailable.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(["all", ...yearsAvailable] as const).map((y) => (
            <button
              key={y}
              onClick={() => setActiveYear(y)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeYear === y
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {y === "all" ? "All Years" : ordinalYear(y)}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-40 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && courses.length > 0 && sections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <GraduationCap className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">No sections yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Create the first section to get started</p>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Section</Button>
        </div>
      )}

      {/* Sections grouped by department, then course + year */}
      {!isLoading && deptGroups.length > 0 && (
        <div className="space-y-10">
          {deptGroups.map((dg) => {
            const deptTotal = dg.groups.reduce((sum, g) => sum + g.sections.length, 0);
            return (
              <div key={dg.department}>
                {activeDepartmentId === "all" && (
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                    <h2 className="font-bold text-lg">{dg.department}</h2>
                    <span className="text-xs text-muted-foreground">
                      {deptTotal} section{deptTotal !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                <div className="space-y-8">
                  {dg.groups.map((g) => {
                    const sts = g.sections.reduce((s, r) => s + (r.studentCount ?? 0), 0);
                    const req = sts > 0 ? Math.ceil(sts / STUDENT_FACULTY_RATIO) : 0;
                    return (
                      <div key={`${g.courseId}_${g.year}`}>
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="font-semibold text-base">
                            {g.courseName} · {ordinalYear(g.year)}
                          </h3>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${yearBadge(g.year)}`}>
                            {g.sections.length} section{g.sections.length !== 1 ? "s" : ""} · {sts} students
                            {req > 0 && <span className="ml-1 opacity-75">· {req} faculty needed</span>}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {g.sections.map((sec) => (
                    <Link
                      key={sec.id}
                      href={`/college-office/sections/${sec.id}`}
                      className={`rounded-xl border-2 p-5 flex flex-col gap-3 hover:opacity-90 transition-opacity ${yearColor(sec.year)}`}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-2xl font-bold tracking-tight">{sectionDisplayLabel(sec, departments)}</p>
                          <p className="text-xs font-medium opacity-70 mt-0.5">{sec.department || "(no department)"}</p>
                          {sec.secondaryDepartments && sec.secondaryDepartments.length > 0 && (
                            <p className="text-xs font-medium opacity-70 mt-0.5">→ {sec.secondaryDepartments.join(", ")}</p>
                          )}
                          <p className="text-sm opacity-70 mt-0.5">{sec.batch}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 mt-1">
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/college-office/sections/${sec.id}/edit`); }}
                            className="p-1 -m-1 rounded-md hover:bg-black/10 transition-colors"
                            title="Edit section"
                          >
                            <Pencil className="h-3.5 w-3.5 opacity-60" />
                          </button>
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(sec); }}
                            className="p-1 -m-1 rounded-md hover:bg-black/10 transition-colors"
                            title="Delete section"
                          >
                            <Trash2 className="h-3.5 w-3.5 opacity-60" />
                          </button>
                          <Eye className="h-3.5 w-3.5 opacity-50" />
                        </div>
                      </div>

                      {/* Faculty incharge */}
                      <div className="flex items-center gap-2">
                        <UserCog className="h-4 w-4 opacity-50 shrink-0" />
                        <span className="text-sm">
                          {sec.facultyInchargeName
                            ? <strong>{sec.facultyInchargeName}</strong>
                            : <span className="opacity-50 italic">No incharge assigned</span>
                          }
                        </span>
                      </div>

                      {/* Student intake + faculty ratio */}
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 opacity-50 shrink-0" />
                        <span className="text-sm">
                          <strong>{sec.studentCount ?? 0}</strong> students
                        </span>
                      </div>
                      {(sec.studentCount ?? 0) > 0 && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <GraduationCap className="h-4 w-4 opacity-50 shrink-0" />
                          <span className="text-sm">
                            <strong>{Math.ceil((sec.studentCount ?? 0) / STUDENT_FACULTY_RATIO)}</strong> faculty needed
                            <span className="text-[11px] opacity-60 ml-1">(1:{STUDENT_FACULTY_RATIO})</span>
                          </span>
                        </div>
                      )}
                    </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete Section ${deleteTarget?.name ?? ""}?`}
        description={`This removes Section ${deleteTarget?.name ?? ""} (${deleteTarget?.department ?? ""}) permanently. It can only be deleted while it has no enrolled students.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
