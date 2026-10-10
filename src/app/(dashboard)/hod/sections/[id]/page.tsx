"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { resolveListBack, withListBack } from "@/lib/listReturn";
import Link from "next/link";
import { ArrowLeft, Users, UserCog, BookOpen, Search, Pencil, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import type { Course, CourseYearTiming, Department, SectionListItem, StudentRecord, Subject, SubjectSemesterAssignment, TeachingAssignment } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";

type SectionRow = SectionListItem;
type AssignmentRow = TeachingAssignment & { id: string };

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Curriculum-table order: by S.No. when set, falling back to name for legacy
// subjects that predate the field - same sort as academics/subjects/page.tsx.
function sortSubjects(subjects: Subject[]) {
  return [...subjects].sort((a, b) => {
    if (a.serialNumber != null && b.serialNumber != null) return a.serialNumber - b.serialNumber;
    if (a.serialNumber != null) return -1;
    if (b.serialNumber != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

export default function SectionRosterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // The Sections list as this page was opened from (filters, page).
  const listHref = resolveListBack(useSearchParams(), "/hod/sections");
  const [section, setSection] = useState<SectionRow | null>(null);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // isLoading already starts true, so nothing is set synchronously here -
    // a setState in the effect body triggers a cascading render.
    void (async () => {
      try {
        const d = await fetch("/api/college/sections")
          .then((r) => r.json() as Promise<{ sections: SectionRow[] }>);
        const sec = (d.sections ?? []).find((s) => s.id === id) ?? null;
        setSection(sec);
        if (!sec) {
          toast({ variant: "destructive", title: "Section not found" });
          return;
        }
        // Resolved before the subjects fetch below, not alongside it in the
        // same Promise.all - the subjects fetch's own URL needs catalogId
        // (and, for the semester-scoped path, departmentId) in hand first.
        // courses is auto-scoped to this HOD's own departments server-side
        // (no departmentId param - see /api/college/courses GET's own HOD
        // branch), matching this page's HOD-only access. departmentId is
        // resolved from the section's own department NAME (Section has no
        // id field for it) against the full department list, the same way
        // /api/college/departments is already used read-only elsewhere in
        // this file tree.
        const [catalogId, departmentId] = await Promise.all([
          sec.courseId
            ? fetch("/api/college/courses")
                .then((r) => r.json() as Promise<{ courses?: Course[] }>)
                .then((cd) => cd.courses?.find((c) => c.id === sec.courseId)?.catalogId)
                .catch(() => undefined)
            : Promise.resolve(undefined),
          fetch("/api/college/departments")
            .then((r) => r.json() as Promise<{ departments?: Department[] }>)
            .then((dd) => dd.departments?.find((d) => d.name === sec.department)?.id)
            .catch(() => undefined),
        ]);

        // Whether this course-year actually has semesters configured
        // (CourseYearTiming.semesters - see academics/assign-semester/page.tsx)
        // decides which subject source is authoritative below. A course-year
        // with none configured never gets SubjectSemesterAssignment rows at
        // all (single continuous timetable, the common case - see
        // SubjectSemesterAssignment's own doc-comment in types/teaching.ts),
        // so there's nothing to scope by there and the master-subject list
        // stays the only source, same as before this fix.
        const hasSemesters = sec.courseId
          ? await fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(sec.courseId)}`)
              .then((r) => r.json() as Promise<{ timings?: CourseYearTiming[] }>)
              .then((d) => (d.timings ?? []).some((t) => t.year === sec.year && (t.semesters?.length ?? 0) > 0))
              .catch(() => false)
          : false;

        await Promise.all([
          // Students API scopes by section NAME + year, not id - section names
          // aren't unique across departments, so narrow client-side (same
          // caveat as the Principal promotions roster fetch). A shared-first-
          // year student stays filed under their common department until
          // promotion (department preserved, secondaryDepartment names their
          // real branch - see students/[id] PATCH) - the section they're
          // actually sitting in belongs to secondaryDepartment in that case,
          // not department, so match either.
          fetch(`/api/college/students?section=${encodeURIComponent(sec.name)}&year=${sec.year}`)
            .then((r) => r.json() as Promise<{ students: StudentRecord[] }>)
            .then((sd) => setStudents((sd.students ?? []).filter(
              (s) => s.department === sec.department || s.secondaryDepartment === sec.department
            ))),
          fetch(`/api/college/teaching-assignments?sectionId=${id}`)
            .then((r) => r.json() as Promise<{ assignments: AssignmentRow[] }>)
            .then((ad) => setAssignments(ad.assignments ?? [])),
          // Master subjects have no per-year field at all on new data (see
          // Subject.year's own "legacy" doc-comment in types/teaching.ts) -
          // querying by courseId/catalogId alone (the previous behavior here)
          // always returned every subject for the WHOLE course, every year,
          // regardless of the `year` param this used to pass (the subjects
          // GET route never reads one). The only real per-year/semester
          // signal is the SubjectSemesterAssignment junction (same mechanism
          // Teaching Assignments already uses, see its own
          // semesterFilteredKeys effect) - when this course-year has
          // semesters configured, join against it (any semester: a Section
          // spans the whole year, not one semester, unlike Teaching
          // Assignments' own per-semester picker) so only subjects actually
          // mapped into THIS department's year show up. Falls back to the
          // full course subject list only when this course-year genuinely
          // has no semesters configured (see hasSemesters above).
          sec.courseId
            ? (hasSemesters && departmentId
                ? Promise.all([
                    fetch(`/api/college/subject-semester-assignments?courseId=${encodeURIComponent(sec.courseId)}&departmentId=${encodeURIComponent(departmentId)}&year=${sec.year}`)
                      .then((r) => r.json() as Promise<{ assignments?: SubjectSemesterAssignment[] }>),
                    fetch(catalogId
                      ? `/api/college/subjects?catalogId=${encodeURIComponent(catalogId)}`
                      : `/api/college/subjects?courseId=${encodeURIComponent(sec.courseId)}`)
                      .then((r) => r.json() as Promise<{ subjects: Subject[] }>),
                  ]).then(([assignData, subjData]) => {
                    const assignedIds = new Set((assignData.assignments ?? []).map((a) => a.subjectId));
                    setSubjects((subjData.subjects ?? []).filter((s) => assignedIds.has(s.id)));
                  })
                : fetch(catalogId
                    ? `/api/college/subjects?catalogId=${encodeURIComponent(catalogId)}`
                    : `/api/college/subjects?courseId=${encodeURIComponent(sec.courseId)}`)
                    .then((r) => r.json() as Promise<{ subjects: Subject[] }>)
                    .then((sd) => setSubjects(sd.subjects ?? [])))
            : Promise.resolve(),
        ]);
      } catch {
        toast({ variant: "destructive", title: "Failed to load section" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [id]);

  // Narrowed to this section's own curriculum regulation, if it has one set -
  // lenient both ways (a subject with no regulation still matches, and a
  // section with no regulation shows every subject), same filter Teaching
  // Assignments applies to its own subject picker.
  const sectionSubjects = useMemo(
    () => sortSubjects(
      subjects.filter((s) => !section?.regulation || !s.regulation || s.regulation === section.regulation)
    ),
    [subjects, section]
  );
  const assignmentBySubjectId = useMemo(
    () => new Map(assignments.map((a) => [a.subjectId, a])),
    [assignments]
  );
  // How many of THIS section's own year/semester subjects (sectionSubjects,
  // now correctly scoped above) have nobody assigned yet - previously this
  // would have counted every subject in the whole course across every year,
  // wildly overstating the gap.
  const unassignedSubjectsCount = useMemo(
    () => sectionSubjects.filter((s) => !assignmentBySubjectId.has(s.id)).length,
    [sectionSubjects, assignmentBySubjectId]
  );

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.rollNumber.toLowerCase().includes(q) ||
        (s.email && s.email.toLowerCase().includes(q)) ||
        (s.secondaryDepartment && s.secondaryDepartment.toLowerCase().includes(q)) ||
        (s.gender && s.gender.toLowerCase().includes(q)) ||
        (s.guardianContact && s.guardianContact.includes(q))
    );
  }, [students, search]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const paginatedStudents = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredStudents.slice(start, start + pageSize);
  }, [filteredStudents, safePage, pageSize]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loading..." description="" />
        <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      </div>
    );
  }

  if (!section) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Section not found"
          description=""
          actions={<Button variant="outline" asChild><Link href={listHref}><ArrowLeft className="h-4 w-4 mr-1" />Back to Sections</Link></Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Section ${section.name}`}
        description={`${section.department ?? ""}${section.department && section.courseName ? " · " : ""}${section.courseName ?? ""}${section.secondaryDepartments && section.secondaryDepartments.length > 0 ? ` → ${section.secondaryDepartments.join(", ")}` : ""} · ${ordinalYear(section.year)} · ${section.batch}${section.regulation ? ` · ${section.regulation}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={listHref}>
                <ArrowLeft className="h-4 w-4 mr-1" />Back to Sections
              </Link>
            </Button>
            {section.accessLevel !== "secondary" && (
              <Button asChild>
                <Link href={withListBack(`/hod/sections/${id}/edit`, listHref, "/hod/sections")}>
                  <Pencil className="h-4 w-4 mr-1.5" />Edit Section & CR
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4" />
          <span><strong className="text-foreground">{students.length}</strong> student{students.length !== 1 ? "s" : ""} enrolled</span>
        </div>
        <div className="flex items-center gap-1.5">
          <UserCheck className="h-4 w-4" />
          <span>
            Class Leader (CR):{" "}
            {section.classLeaderUid ? (
              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                Active
              </Badge>
            ) : (
              <span className="text-muted-foreground">Not created</span>
            )}
          </span>
        </div>
        {section.accessLevel === "secondary" && (
          <Badge variant="secondary" className="text-xs">View only</Badge>
        )}
      </div>

      {section.courseId && (
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <BookOpen className="h-4 w-4" />Subjects
            {section.regulation && <Badge variant="secondary" className="text-xs">{section.regulation}</Badge>}
            {unassignedSubjectsCount > 0 && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                {unassignedSubjectsCount} unassigned faculty
              </Badge>
            )}
          </p>
          {sectionSubjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subjects added yet for {section.courseName ?? "this course"} · {ordinalYear(section.year)}
              {section.regulation ? ` · ${section.regulation}` : ""}.
            </p>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">S.No.</th>
                      <th className="px-4 py-2.5">Subject</th>
                      <th className="px-4 py-2.5">Faculty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sectionSubjects.map((s) => {
                      const assignment = assignmentBySubjectId.get(s.id);
                      return (
                        <tr key={s.id}>
                          <td className="px-4 py-2.5">{s.serialNumber ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-foreground">{s.name}</div>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              <Badge variant="secondary" className="text-xs font-mono">{s.code}</Badge>
                              <Badge variant="outline" className="text-xs">{SUBJECT_TYPE_LABELS[s.type]}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-1.5">
                              <UserCog className="h-3.5 w-3.5 text-muted-foreground" />
                              {assignment?.facultyName || <span className="text-muted-foreground">Unassigned</span>}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Enrolled Students</span>
            <Badge variant="secondary" className="text-xs">
              {filteredStudents.length}
            </Badge>
          </div>
          {students.length > 0 && (
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search roll no, name..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-8 h-9 text-sm"
              />
            </div>
          )}
        </div>
        <CardContent className="p-0">
          {students.length === 0 ? (
            <div className="py-16">
              <EmptyState
                title="No students in this section yet"
                description="Students will show up here once added."
                icon={<Users className="h-8 w-8" />}
              />
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="py-12">
              <EmptyState
                title="No students match your search"
                description={`No results found for "${search}".`}
                icon={<Search className="h-8 w-8" />}
                action={
                  <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                    Clear Search
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Roll No.</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                      {students.some((s) => s.secondaryDepartment) && (
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Registered Branch</th>
                      )}
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Gender</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Guardian Contact</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {paginatedStudents.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => router.push(`/hod/students/${s.id}`)}
                        className="cursor-pointer hover:bg-muted/40 transition-colors"
                      >
                        <td className="px-4 py-2.5 font-mono">{s.rollNumber}</td>
                        <td className="px-4 py-2.5 font-medium">{s.name}</td>
                        {students.some((st) => st.secondaryDepartment) && (
                          <td className="px-4 py-2.5">
                            {s.secondaryDepartment
                              ? <Badge variant="outline" className="text-xs">{s.secondaryDepartment}</Badge>
                              : <span className="text-muted-foreground">-</span>}
                          </td>
                        )}
                        <td className="px-4 py-2.5">
                          <Badge variant={s.status === "REGULAR" ? "default" : "secondary"} className="text-xs">
                            {s.status === "REGULAR" ? "Regular" : s.status === "DETAINED" ? "Detained" : "Graduated"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{s.gender || "-"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{s.guardianContact || "-"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{s.email || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-4 border-t">
                <Pagination
                  page={safePage}
                  pageSize={pageSize}
                  total={filteredStudents.length}
                  onPageChange={setPage}
                  onPageSizeChange={(newSize) => {
                    setPageSize(newSize);
                    setPage(1);
                  }}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
