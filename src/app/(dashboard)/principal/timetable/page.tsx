"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { FacultyLeisureFilter } from "@/components/timetable/FacultyLeisureFilter";
import { TeachingNowFilter } from "@/components/timetable/TeachingNowFilter";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import { ordinalYear, resolveTimetableDays, latestEffectiveDate } from "@/lib/timetable/gridModel";
import { buildSectionTimetablePdfHtml } from "@/lib/timetable/sectionTimetablePdf";
import { buildSectionTimetableXlsxBuffer } from "@/lib/timetable/timetableExport";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import { useFacultyDesignations, withDesignation } from "@/hooks/useFacultyDesignations";
import { slotsWithDisplayNames } from "@/lib/faculty/displayNameApply";
import { renderMultiHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import type { Course, Department, Section, CourseYearTiming, TimetableSlot, Subject, DayOfWeek } from "@/types";
import { DepartmentPickSelect } from "@/components/shared/DepartmentPickSelect";
import { buildDepartmentPickOptions, DEPARTMENT_PICK_ALL, dropEmptyFeederGroups, parseDepartmentPick } from "@/lib/departments/departmentPickTree";
import { sectionIsOfCore, sectionMatchesPick } from "@/lib/departments/sectionDepartmentPick";
import { departmentsOfferingCourse } from "@/components/students/RosterFieldInputs";
import { yearSemesterLabelIn } from "@/lib/academic/format";

// One section's current-semester timetable, as GET /api/college/timetable-slots/export-all
// returns it - everything buildSectionTimetablePdfHtml/buildSectionTimetableXlsxBuffer need,
// per section, for the filtered view and downloads below.
interface BulkSectionEntry {
  sectionId: string;
  sectionName: string;
  departmentName: string;
  courseName: string;
  year: number;
  batch: string;
  regulation?: string;
  classroomNumber?: string;
  facultyInchargeName?: string;
  facultyInchargeUid?: string;
  currentSemester: number | null;
  timing: CourseYearTiming;
  slots: TimetableSlot[];
}

// Read-only view of PUBLISHED timetables for the Principal and Vice Principal.
// Reads `timetableSlots`, which only ever contains published slots - drafts live
// in a separate collection, so an in-progress timetable can never appear here.
// VICE_PRINCIPAL reaches this page through its inherited access to /principal/*
// (see ROLE_PATH_MAP in src/proxy.ts).

// The college-wide "who is free at this time" filter is an optional toggle. The
// page is re-exported for Academics, which does not get it (the
// /api/college/faculty-leisure guard enforces the real role list). Hidden for Academics only; a "working as" seat can change user.role, so this
// is a denylist rather than an allowlist.
const NO_LEISURE_ROLES = ["ACADEMICS"];
// "Teaching at this time" is for the Principal, Vice Principal and admins only
// (api/college/teaching-now enforces the real list). This page is also
// re-exported for Exam Cell and Academics, who do not get it. A denylist for
// the same reason as above: a "working as" seat can change user.role.
const NO_TEACHING_NOW_ROLES = ["ACADEMICS", "EXAM_CELL"];

const PAGE_STEP = 10;

export default function PrincipalTimetablePage() {
  const { user } = useAuth();
  // Settings > Website Display Name > "Section timetable": the all-sections PDF / Excel print faculty by Display Name.
  const { nameFor } = useFacultyDisplayNames();
  const canSeeLeisure = !NO_LEISURE_ROLES.includes(user?.role ?? "");
  const canSeeTeachingNow = !!user && !NO_TEACHING_NOW_ROLES.includes(user.role);
  const [panel, setPanel] = useState<"" | "leisure" | "teaching">("");

  // One view for every case: pick Course / Department / Year / Section (each defaults to "All"), press Load.
  // Nothing about the timetables is read until Load: the pickers are built from the sections list alone
  // (no slots), and Load then reads the timetables of exactly the sections the picks reach.
  interface OptionSection { id: string; name: string; department: string; year: number; courseId: string; courseName: string }
  const [optionSections, setOptionSections] = useState<OptionSection[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [bulkSections, setBulkSections] = useState<BulkSectionEntry[]>([]);
  const designationOf = useFacultyDesignations(bulkSections.map((e) => e.facultyInchargeUid));
  const [bulkSubjects, setBulkSubjects] = useState<Subject[]>([]);
  const [bulkWorkingDays, setBulkWorkingDays] = useState<DayOfWeek[]>([]);
  const [isLoadingTimetables, setIsLoadingTimetables] = useState(false);
  const [isExportingAllPdf, setIsExportingAllPdf] = useState(false);
  const [isExportingAllZip, setIsExportingAllZip] = useState(false);
  const [fCourse, setFCourse] = useState("");
  const [deptPick, setDeptPick] = useState(DEPARTMENT_PICK_ALL);
  const [fYear, setFYear] = useState("");
  const [fSection, setFSection] = useState("");
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const { collegeInfo } = useCollegeInfo();
  const optionsLoading = optionSections === null && !optionsError;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/college/timetable-slots/export-all?optionsOnly=1").then((r) => r.json() as Promise<{ sections?: OptionSection[]; error?: string }>),
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>),
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: Department[] }>),
    ])
      .then(([sec, cou, dep]) => {
        if (cancelled) return;
        if (sec.error) throw new Error(sec.error);
        setOptionSections(sec.sections ?? []);
        setCourses(cou.courses ?? []);
        setDepartments(dep.departments ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setOptionsError(true);
          toast({ variant: "destructive", title: "Failed to load the timetable filters" });
        }
      });
    return () => { cancelled = true; };
  }, []);

  const sortedUnique = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const allSections = useMemo(() => optionSections ?? [], [optionSections]);
  const sectionDepartmentNames = useMemo(() => sortedUnique(allSections.map((x) => x.department)), [allSections]);
  const catalogIdByCourseId = useMemo(() => new Map(courses.map((c) => [c.id, c.catalogId])), [courses]);
  // A section is reached by a Department pick the way every sections view reaches it: the year-aware rule
  // of the department that runs it (a sub-department or shared-year department reaches its branches' years),
  // then the core branch if one is picked (lib/departments/sectionDepartmentPick.ts).
  const matchesPick = (x: OptionSection, pick: string) => {
    const { department, coreDepartment } = parseDepartmentPick(pick);
    return (!department || sectionMatchesPick(departments, department, x, catalogIdByCourseId.get(x.courseId), sectionDepartmentNames))
      && (!coreDepartment || sectionIsOfCore(departments, coreDepartment, x.department));
  };
  // Each picker lists only what the ones before it leave - worked out from the configuration and the
  // section list, never from timetables.
  const filterCourses = useMemo(() => sortedUnique(allSections.map((x) => x.courseName).filter(Boolean)), [allSections]);
  const inCourse = useMemo(() => allSections.filter((x) => !fCourse || x.courseName === fCourse), [allSections, fCourse]);
  const deptPickOptions = useMemo(() => {
    const active = departments.filter((d) => d.isActive !== false);
    const offered = fCourse
      ? (() => {
        const ids = new Set(departmentsOfferingCourse(departments, courses, fCourse).map((d) => d.id));
        return active.filter((d) => ids.has(d.id));
      })()
      : active;
    return dropEmptyFeederGroups(buildDepartmentPickOptions(offered, departments, sectionDepartmentNames), sectionDepartmentNames);
  }, [departments, courses, fCourse, sectionDepartmentNames]);
  const inDept = useMemo(
    () => inCourse.filter((x) => matchesPick(x, deptPick)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inCourse, deptPick, departments, catalogIdByCourseId, sectionDepartmentNames]
  );
  const filterYears = useMemo(() => [...new Set(inDept.map((x) => x.year))].sort((a, b) => a - b), [inDept]);
  const filterSections = useMemo(
    () => inDept.filter((x) => !fYear || String(x.year) === fYear),
    [inDept, fYear]
  );
  const draftKey = `${fCourse}|${deptPick}|${fYear}|${fSection}`;
  const filtersChanged = appliedKey !== null && appliedKey !== draftKey;
  // The sections the list and the downloads cover: exactly what the last Load read.
  const shownSections = bulkSections;

  async function handleLoadTimetables() {
    const ids = (fSection ? filterSections.filter((x) => x.id === fSection) : filterSections).map((x) => x.id);
    setIsLoadingTimetables(true);
    try {
      if (ids.length === 0) {
        setBulkSections([]); setBulkSubjects([]);
      } else {
        // At most 150 sections a request (the server's cap); the pieces are merged.
        const parts: string[][] = [];
        for (let i = 0; i < ids.length; i += 150) parts.push(ids.slice(i, i + 150));
        const results = await Promise.all(parts.map((part) =>
          fetch(`/api/college/timetable-slots/export-all?sectionIds=${part.join(",")}`)
            .then((r) => r.json() as Promise<{ sections?: BulkSectionEntry[]; subjects?: Subject[]; workingDays?: DayOfWeek[]; error?: string }>)
        ));
        const failed = results.find((r) => r.error);
        if (failed) throw new Error(failed.error);
        setBulkSections(results.flatMap((r) => r.sections ?? []));
        setBulkSubjects([...new Map(results.flatMap((r) => r.subjects ?? []).map((x) => [x.id, x])).values()]);
        setBulkWorkingDays(results[0]?.workingDays ?? []);
      }
      setAppliedKey(draftKey);
      setVisibleCount(PAGE_STEP);
    } catch {
      toast({ variant: "destructive", title: "Failed to load timetables" });
    } finally {
      setIsLoadingTimetables(false);
    }
  }

  function exportMetaFor(entry: BulkSectionEntry) {
    const days = resolveTimetableDays(
      bulkWorkingDays.length ? { workingDays: bulkWorkingDays } : null,
      entry.slots.map((s) => s.day)
    );
    const occupied = new Set(entry.slots.map((s) => s.day));
    const visibleDays = days.filter((d) => occupied.has(d));
    const inYear = (entry.timing.semesters ?? []).map((s) => s.semester);
    return {
      collegeName: collegeInfo?.name,
      collegeCode: collegeInfo?.code,
      affiliation: collegeInfo?.affiliation,
      city: collegeInfo?.city,
      phone: collegeInfo?.phone,
      logoUrl: collegeInfo?.logoUrl,
      departmentName: entry.departmentName,
      courseName: entry.courseName,
      academicYear: entry.slots[0]?.academicYear,
      semesterLabel: entry.currentSemester != null ? `Sem ${yearSemesterLabelIn(entry.year, inYear, entry.currentSemester)}` : undefined,
      effectiveDate: latestEffectiveDate(entry.slots),
      regulation: entry.regulation,
      classroom: entry.classroomNumber,
      classInchargeName: entry.facultyInchargeName ? withDesignation(nameFor("sectionTimetable", { uid: entry.facultyInchargeUid }, entry.facultyInchargeName), designationOf(entry.facultyInchargeUid)) : entry.facultyInchargeName,
      days: visibleDays.length > 0 ? visibleDays : days,
      periods: Array.from({ length: entry.timing.numberOfPeriods }, (_, i) => i + 1),
      periodTimings: entry.timing.periods ?? [],
      timing: entry.timing,
      slots: slotsWithDisplayNames(entry.slots, "sectionTimetable", nameFor),
      lunchBreak: entry.timing.lunchBreak,
      shortBreaks: entry.timing.shortBreaks,
      subjects: bulkSubjects,
      signatureRows: collegeInfo?.timetableSignatureRows,
    };
  }

  async function handleDownloadAllPdf() {
    if (shownSections.length === 0) return;
    setIsExportingAllPdf(true);
    try {
      const htmls = shownSections.map((entry) =>
        buildSectionTimetablePdfHtml({
          ...exportMetaFor(entry),
          section: { name: entry.sectionName, department: entry.departmentName, year: entry.year, courseName: entry.courseName, classroomNumber: entry.classroomNumber, facultyInchargeName: entry.facultyInchargeName },
        })
      );
      await renderMultiHtmlToPdf(htmls, `All_Departments_Timetables_${isoDateKey(new Date())}.pdf`);
      toast({ title: "Downloaded", description: `${shownSections.length} sections combined into one PDF` });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Download failed", description: "Failed to generate the combined PDF" });
    } finally {
      setIsExportingAllPdf(false);
    }
  }

  async function handleDownloadAllXlsxZip() {
    if (shownSections.length === 0) return;
    setIsExportingAllZip(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const entry of shownSections) {
        const buffer = await buildSectionTimetableXlsxBuffer({
          ...exportMetaFor(entry),
          sectionName: entry.sectionName,
          sectionYear: entry.year,
          batch: entry.batch,
        });
        let name = `${entry.departmentName}_Y${entry.year}_${entry.sectionName}`.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
        if (usedNames.has(name)) name = `${name}_${entry.sectionId.slice(0, 6)}`;
        usedNames.add(name);
        zip.file(`${name}.xlsx`, buffer);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `All_Departments_Timetables_${isoDateKey(new Date())}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded", description: `${shownSections.length} section workbooks zipped` });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Export failed", description: "Failed to build the Excel ZIP" });
    } finally {
      setIsExportingAllZip(false);
    }
  }

  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Timetable View" description="Published section timetables across the college" />

      {canSeeLeisure && (
        <div className="flex flex-wrap gap-2" role="tablist">
          {([
            ["", "Section timetable"],
            ["leisure", "Leisure faculty"],
            ...(canSeeTeachingNow ? [["teaching", "Teaching at this time"]] : []),
          ] as [typeof panel, string][]).map(([key, label]) => (
            <button
              key={key || "timetable"}
              type="button"
              role="tab"
              aria-selected={panel === key}
              className={`h-9 rounded-md border px-3 text-sm font-medium ${
                panel === key ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted"
              }`}
              onClick={() => setPanel(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {panel === "leisure" && <FacultyLeisureFilter />}
      {panel === "teaching" && canSeeTeachingNow && <TeachingNowFilter />}

      {/* Kept mounted (just hidden) so the picked filters survive a visit to another tab. */}
      <div className={panel === "" ? "space-y-6" : "hidden"}>
        {optionsLoading ? (
          <div className="h-20 rounded-md border bg-muted/30 animate-pulse" />
        ) : optionsError || optionSections === null ? (
          <p className="text-sm text-muted-foreground">Could not load.</p>
        ) : optionSections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sections have been created yet.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="tt-course">Course</label>
                <select id="tt-course" className={selectClass} value={fCourse}
                  onChange={(e) => { setFCourse(e.target.value); setDeptPick(DEPARTMENT_PICK_ALL); setFYear(""); setFSection(""); }}>
                  <option value="">All courses</option>
                  {filterCourses.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="tt-department">Department</label>
                {/* Sub-departments and core branches sit indented under their department - one field. */}
                <DepartmentPickSelect
                  id="tt-department" value={deptPick} options={deptPickOptions} className="h-9 w-full"
                  onChange={(v) => { setDeptPick(v); setFYear(""); setFSection(""); }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="tt-year">Year</label>
                <select id="tt-year" className={selectClass} value={fYear}
                  onChange={(e) => { setFYear(e.target.value); setFSection(""); }}>
                  <option value="">All years</option>
                  {filterYears.map((y) => <option key={y} value={String(y)}>{ordinalYear(y)}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="tt-section">Section</label>
                <select id="tt-section" className={selectClass} value={fSection} onChange={(e) => setFSection(e.target.value)}>
                  <option value="">All sections</option>
                  {filterSections.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.department} · {ordinalYear(e.year)} · {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={() => void handleLoadTimetables()} disabled={isLoadingTimetables || filterSections.length === 0}>
                {isLoadingTimetables ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                {isLoadingTimetables ? "Loading…" : filtersChanged ? "Apply filters" : appliedKey ? "Reload timetables" : "Load timetables"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{filterSections.length} section{filterSections.length === 1 ? "" : "s"} match - Load reads their published timetables.</p>

            {appliedKey && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{shownSections.length}</span> section
                {shownSections.length === 1 ? "" : "s"} with a published timetable for its current semester.
              </p>
            )}
            {shownSections.length > 0 && (
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleDownloadAllPdf} disabled={isExportingAllPdf}>
                  {isExportingAllPdf ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  {isExportingAllPdf ? "Generating..." : "Download combined PDF"}
                </Button>
                <Button variant="outline" onClick={handleDownloadAllXlsxZip} disabled={isExportingAllZip}>
                  {isExportingAllZip ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
                  {isExportingAllZip ? "Zipping..." : "Download Excel files (ZIP)"}
                </Button>
              </div>
            )}

            {!appliedKey ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Leave a filter on &ldquo;All&rdquo; or narrow it down, then press Load timetables.
              </div>
            ) : shownSections.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No published timetable for this selection.
              </div>
            ) : (
              <div className="space-y-6">
                {shownSections.slice(0, visibleCount).map((entry) => {
                  const inYear = (entry.timing.semesters ?? []).map((x) => x.semester);
                  return (
                    <div key={entry.sectionId} className="space-y-2">
                      <h4 className="text-sm font-semibold">
                        {entry.courseName} · {entry.departmentName} · {ordinalYear(entry.year)} · Section {entry.sectionName}
                      </h4>
                      <InstitutionalTimetableTable
                        section={{ name: entry.sectionName, department: entry.departmentName, year: entry.year, courseName: entry.courseName, classroomNumber: entry.classroomNumber, facultyInchargeName: entry.facultyInchargeName, facultyInchargeUid: entry.facultyInchargeUid } as unknown as Section}
                        timing={entry.timing}
                        slots={entry.slots}
                        courseName={entry.courseName}
                        departmentName={entry.departmentName}
                        academicYear={entry.slots[0]?.academicYear}
                        semesterLabel={entry.currentSemester != null ? `Sem ${yearSemesterLabelIn(entry.year, inYear, entry.currentSemester)}` : undefined}
                        workingDays={bulkWorkingDays}
                        showWeekNav={false}
                        hideTitle
                        subjects={bulkSubjects}
                      />
                    </div>
                  );
                })}
                {shownSections.length > visibleCount && (
                  <Button variant="outline" onClick={() => setVisibleCount((n) => n + PAGE_STEP)}>
                    Show more ({shownSections.length - visibleCount} left)
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
