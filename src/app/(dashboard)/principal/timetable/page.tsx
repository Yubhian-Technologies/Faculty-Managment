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
import { renderMultiHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import type { Section, CourseYearTiming, TimetableSlot, Subject, DayOfWeek } from "@/types";
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
  const canSeeLeisure = !NO_LEISURE_ROLES.includes(user?.role ?? "");
  const canSeeTeachingNow = !!user && !NO_TEACHING_NOW_ROLES.includes(user.role);
  const [panel, setPanel] = useState<"" | "leisure" | "teaching">("");

  // One view for every case: pick Course / Department / Year / Section (each defaults to "All"), press Load.
  // Everything comes from the college-wide current-semester export, so one filter set covers a single
  // section as well as many departments or years.
  const [bulkSections, setBulkSections] = useState<BulkSectionEntry[] | null>(null);
  const [bulkError, setBulkError] = useState(false);
  const [bulkSubjects, setBulkSubjects] = useState<Subject[]>([]);
  const [bulkWorkingDays, setBulkWorkingDays] = useState<DayOfWeek[]>([]);
  const [isExportingAllPdf, setIsExportingAllPdf] = useState(false);
  const [isExportingAllZip, setIsExportingAllZip] = useState(false);
  const [fCourse, setFCourse] = useState("");
  const [fDept, setFDept] = useState("");
  const [fYear, setFYear] = useState("");
  const [fSection, setFSection] = useState("");
  const [appliedFilter, setAppliedFilter] = useState<{ course: string; dept: string; year: string; section: string } | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const { collegeInfo } = useCollegeInfo();
  // Derived rather than a separate flag - a synchronous setState(true) inside
  // the fetch effect would be a cascading render (react-hooks/set-state-in-effect).
  const bulkLoading = bulkSections === null && !bulkError;

  useEffect(() => {
    if (bulkSections !== null || bulkError) return;
    let cancelled = false;
    void fetch("/api/college/timetable-slots/export-all")
      .then((r) => r.json() as Promise<{ sections?: BulkSectionEntry[]; subjects?: Subject[]; workingDays?: DayOfWeek[]; error?: string }>)
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setBulkSections(d.sections ?? []);
        setBulkSubjects(d.subjects ?? []);
        setBulkWorkingDays(d.workingDays ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setBulkError(true);
          toast({ variant: "destructive", title: "Failed to load timetables" });
        }
      });
    return () => { cancelled = true; };
  }, [bulkSections, bulkError]);

  const sortedUnique = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const all = useMemo(() => bulkSections ?? [], [bulkSections]);
  // Each filter lists only what the filters above it leave.
  const filterCourses = useMemo(() => sortedUnique(all.map((e) => e.courseName)), [all]);
  const inCourse = useMemo(() => all.filter((e) => !fCourse || e.courseName === fCourse), [all, fCourse]);
  const filterDepts = useMemo(() => sortedUnique(inCourse.map((e) => e.departmentName)), [inCourse]);
  const inDept = useMemo(() => inCourse.filter((e) => !fDept || e.departmentName === fDept), [inCourse, fDept]);
  const filterYears = useMemo(() => [...new Set(inDept.map((e) => e.year))].sort((a, b) => a - b), [inDept]);
  const filterSections = useMemo(
    () => inDept.filter((e) => !fYear || String(e.year) === fYear)
      .sort((a, b) => a.departmentName.localeCompare(b.departmentName) || a.year - b.year || a.sectionName.localeCompare(b.sectionName)),
    [inDept, fYear]
  );
  // The sections the list and the downloads cover: everything until a filter is loaded.
  const shownSections = useMemo(() => {
    if (!appliedFilter) return all;
    return all.filter(
      (e) =>
        (!appliedFilter.course || e.courseName === appliedFilter.course) &&
        (!appliedFilter.dept || e.departmentName === appliedFilter.dept) &&
        (!appliedFilter.year || String(e.year) === appliedFilter.year) &&
        (!appliedFilter.section || e.sectionId === appliedFilter.section)
    );
  }, [all, appliedFilter]);

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
      address: collegeInfo?.address,
      phone: collegeInfo?.phone,
      logoUrl: collegeInfo?.logoUrl,
      departmentName: entry.departmentName,
      courseName: entry.courseName,
      academicYear: entry.slots[0]?.academicYear,
      semesterLabel: entry.currentSemester != null ? `Sem ${yearSemesterLabelIn(entry.year, inYear, entry.currentSemester)}` : undefined,
      effectiveDate: latestEffectiveDate(entry.slots),
      regulation: entry.regulation,
      days: visibleDays.length > 0 ? visibleDays : days,
      periods: Array.from({ length: entry.timing.numberOfPeriods }, (_, i) => i + 1),
      periodTimings: entry.timing.periods ?? [],
      timing: entry.timing,
      slots: entry.slots,
      lunchBreak: entry.timing.lunchBreak,
      shortBreaks: entry.timing.shortBreaks,
      subjects: bulkSubjects,
    };
  }

  async function handleDownloadAllPdf() {
    if (shownSections.length === 0) return;
    setIsExportingAllPdf(true);
    try {
      const htmls = shownSections.map((entry) =>
        buildSectionTimetablePdfHtml({
          ...exportMetaFor(entry),
          section: { name: entry.sectionName, department: entry.departmentName, year: entry.year, courseName: entry.courseName },
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
        {bulkLoading ? (
          <div className="h-20 rounded-md border bg-muted/30 animate-pulse" />
        ) : bulkError || bulkSections === null ? (
          <p className="text-sm text-muted-foreground">Could not load.</p>
        ) : bulkSections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No section has a published timetable for its current semester yet.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="tt-course">Course</label>
                <select id="tt-course" className={selectClass} value={fCourse}
                  onChange={(e) => { setFCourse(e.target.value); setFDept(""); setFYear(""); setFSection(""); }}>
                  <option value="">All courses</option>
                  {filterCourses.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="tt-department">Department</label>
                <select id="tt-department" className={selectClass} value={fDept}
                  onChange={(e) => { setFDept(e.target.value); setFYear(""); setFSection(""); }}>
                  <option value="">All departments</option>
                  {filterDepts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
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
                    <option key={e.sectionId} value={e.sectionId}>
                      {e.departmentName} · {ordinalYear(e.year)} · {e.sectionName}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() => {
                  setAppliedFilter({ course: fCourse, dept: fDept, year: fYear, section: fSection });
                  setVisibleCount(PAGE_STEP);
                }}
              >
                <Search className="h-4 w-4 mr-2" />{appliedFilter ? "Reload timetables" : "Load timetables"}
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{shownSections.length}</span> section
              {shownSections.length === 1 ? "" : "s"} with a published timetable for its current semester
              {appliedFilter ? " for this filter" : ""}.
            </p>
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

            {!appliedFilter ? (
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
                        {entry.courseName} · {entry.departmentName} · {ordinalYear(entry.year)} Year · Section {entry.sectionName}
                      </h4>
                      <InstitutionalTimetableTable
                        section={{ name: entry.sectionName, department: entry.departmentName, year: entry.year, courseName: entry.courseName } as unknown as Section}
                        timing={entry.timing}
                        slots={entry.slots}
                        courseName={entry.courseName}
                        departmentName={entry.departmentName}
                        academicYear={entry.slots[0]?.academicYear}
                        semesterLabel={entry.currentSemester != null ? `Sem ${yearSemesterLabelIn(entry.year, inYear, entry.currentSemester)}` : undefined}
                        workingDays={bulkWorkingDays}
                        showWeekNav={false}
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
