"use client";

import { useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Printer, Loader2, FlaskConical, LayoutGrid, CalendarDays, ListFilter, Info, MapPin, User, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { WeekNavigator } from "@/components/timetable/WeekNavigator";
import { buildSectionTimetablePdfHtml } from "@/lib/timetable/sectionTimetablePdf";
import { downloadSectionTimetableXlsx } from "@/lib/timetable/timetableExport";
import { resolveLogoUrl } from "@/lib/timetable/logoAsset";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { yearSemesterLabelIn } from "@/lib/academic/format";
import {
  buildAllocationList,
  buildClassTimetableSubtitle,
  buildTimetableColumns,
  latestEffectiveDate,
  ordinalYear,
  periodTimeRange,
  readableCode,
  resolveTimetableDays,
  slotFacultyName,
  slotShortCode,
  type TimetableColumn,
  mergeCoTaughtSlots,
  continuousSpans,
  isLabSlot,
} from "@/lib/timetable/gridModel";
import type {
  CourseYearTiming,
  DayOfWeek,
  Section,
  Subject,
  TeachingAssignment,
  TimetableSlot,
} from "@/types";
import { DAY_LABELS } from "@/types";

import { useCollegeInfo } from "@/hooks/useCollegeInfo";

export interface InstitutionalTimetableTableProps {
  section?: Section | null;
  timing: CourseYearTiming;
  slots: TimetableSlot[];
  courseName?: string;
  departmentName?: string;
  collegeName?: string;
  collegeCode?: string;
  affiliation?: string;
  address?: string;
  phone?: string;
  logoUrl?: string;
  academicYear?: string;
  semesterLabel?: string;
  effectiveDate?: string;
  classroom?: string;
  classInchargeName?: string;
  subjects?: Subject[];
  assignments?: TeachingAssignment[];
  /** The college's configured working days - the grid only lays out days on this list. */
  workingDays?: DayOfWeek[];
  weekStart?: Date;
  onWeekChange?: (d: Date) => void;
  showWeekNav?: boolean;
  typeFilter?: "ALL" | "THEORY" | "PRACTICAL";
  onTypeFilterChange?: (t: "ALL" | "THEORY" | "PRACTICAL") => void;
  className?: string;
}

export function InstitutionalTimetableTable({
  section,
  timing,
  slots,
  courseName = section?.courseName ?? "",
  departmentName = section?.department ?? "",
  collegeName,
  collegeCode,
  affiliation,
  address,
  phone,
  logoUrl,
  academicYear = slots[0]?.academicYear ?? "",
  semesterLabel: semesterLabelProp,
  effectiveDate: effectiveDateProp,
  classroom,
  classInchargeName,
  subjects = [],
  assignments = [],
  workingDays,
  weekStart,
  onWeekChange,
  showWeekNav = false,
  typeFilter = "ALL",
  onTypeFilterChange,
  className = "",
}: InstitutionalTimetableTableProps) {
  const { collegeInfo, loading: collegeLoading, failed: collegeFailed } = useCollegeInfo();
  const activeCollegeName = collegeName || collegeInfo?.name || "";
  const activeCollegeCode = collegeCode ?? (collegeInfo?.code || "");
  const activeAffiliation = affiliation ?? (collegeInfo?.affiliation || "");
  const activeAddress = address ?? (collegeInfo?.address || "");
  const activePhone = phone ?? (collegeInfo?.phone || "");

  // Faculty/batches of one subject sharing a period show as ONE entry, subject once.
  // (Merging periods into one cell is chosen per cell in the timetable editor and
  // carried on the slots - see continuousSpans - so there is nothing to toggle here.)
  const cellEntries = (cell: TimetableSlot[]) => mergeCoTaughtSlots(cell);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);

  // Mobile view modes: "matrix" (compact short-code grid across all days), "day" (day-by-day tabs), "list" (full vertical list)
  const [mobileViewMode, setMobileViewMode] = useState<"matrix" | "day" | "list">("matrix");
  const [activeMobileDayTab, setActiveMobileDayTab] = useState<DayOfWeek>("MON");
  const [selectedMobileSlot, setSelectedMobileSlot] = useState<{ slot: TimetableSlot; day: DayOfWeek; col: TimetableColumn } | null>(null);

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  // A caller's own label wins; otherwise the semester these slots were placed
  // under, when they all share one (so a download says which semester it is for).
  const semesterLabel = useMemo(() => {
    if (semesterLabelProp) return semesterLabelProp;
    const sems = Array.from(new Set(slots.map((s) => s.semester).filter((n): n is number => typeof n === "number")));
    if (sems.length !== 1) return undefined;
    const inYear = (timing.semesters ?? []).map((x) => x.semester);
    return `Sem ${yearSemesterLabelIn(Number(timing.year), inYear, sems[0])}`;
  }, [semesterLabelProp, slots, timing]);

  // ── Days: the college's own working days, unioned with any day a slot
  // actually occupies so a slot published on a since-removed working day is
  // still visible rather than silently dropped. ──────────────────────────────
  const days = useMemo(
    () => resolveTimetableDays(workingDays ? { workingDays } : null, slots.map((s) => s.day)),
    [workingDays, slots]
  );

  const columns: TimetableColumn[] = useMemo(
    () => buildTimetableColumns(timing, { lunchLabel: "Lunch Break" }),
    [timing]
  );

  // Filter slots if type filter is active
  const filteredSlots = useMemo(() => {
    if (typeFilter === "ALL") return slots;
    return slots.filter((s) => {
      const type = (s as TimetableSlot & { subjectType?: string }).subjectType;
      if (typeFilter === "THEORY") {
        if (type === "THEORY") return true;
        if (type === "PRACTICAL" || s.labBatch) return false;
        const name = (s.subjectName || "").toLowerCase();
        return !name.includes("lab") && !name.includes("practical");
      }
      if (typeFilter === "PRACTICAL") {
        if (type === "PRACTICAL" || s.labBatch) return true;
        if (type === "THEORY") return false;
        const name = (s.subjectName || "").toLowerCase();
        return name.includes("lab") || name.includes("practical");
      }
      return true;
    });
  }, [slots, typeFilter]);

  // The download always represents exactly what is on screen: the same
  // working-day list, the same type filter. Previously the PDF/XLS were built
  // from the unfiltered `slots`, so toggling Theory/Practical changed the grid
  // and silently did nothing to the file the user saved.
  const visibleDays = useMemo(() => {
    const occupied = new Set(filteredSlots.map((s) => s.day));
    const fromSlots = days.filter((d) => occupied.has(d));
    return fromSlots.length > 0 ? fromSlots : days;
  }, [days, filteredSlots]);

  const allocationList = useMemo(
    () => buildAllocationList(filteredSlots, { subjects: subjectMap, assignments }),
    [filteredSlots, subjectMap, assignments]
  );

  // ── Export payload ────────────────────────────────────────────────────────
  const exportMeta = useMemo(
    () => ({
      collegeName: activeCollegeName,
      collegeCode: activeCollegeCode,
      affiliation: activeAffiliation,
      address: activeAddress,
      phone: activePhone,
      logoUrl: logoUrl ?? (collegeInfo?.logoUrl || ""),
      departmentName,
      courseName,
      academicYear,
      semesterLabel,
      effectiveDate: effectiveDateProp ?? latestEffectiveDate(filteredSlots),
      regulation: section?.regulation,
      section: section ?? undefined,
      classroom,
      classInchargeName: classInchargeName ?? section?.facultyInchargeName ?? "",
      days: visibleDays,
      periods: Array.from({ length: timing.numberOfPeriods }, (_, i) => i + 1),
      periodTimings: timing.periods ?? [],
      timing,
      slots: filteredSlots,
      lunchBreak: timing.lunchBreak,
      shortBreaks: timing.shortBreaks,
      subjects,
      assignments,
    }),
    [
      activeCollegeName, activeCollegeCode, activeAffiliation, activeAddress, activePhone,
      collegeInfo?.logoUrl, logoUrl, departmentName, courseName, academicYear, semesterLabel,
      effectiveDateProp, section, classroom, classInchargeName, visibleDays, timing, filteredSlots, subjects, assignments,
    ]
  );

  const fileBase = useMemo(() => {
    const parts = [courseName || section?.courseName || "Timetable", section?.name ? `Sec_${section.name}` : null, semesterLabel ?? null];
    return parts.filter(Boolean).join("_").replace(/\s+/g, "_");
  }, [courseName, section, semesterLabel]);

  async function handleDownloadPdf() {
    setIsExportingPdf(true);
    try {
      const html = buildSectionTimetablePdfHtml(exportMeta);
      const filename = `${fileBase}.pdf`;
      await renderHtmlToPdf(html, filename);
      toast({ title: "Timetable downloaded", description: `Saved as ${filename}` });
    } catch (err) {
      console.error(err);
      toast({ title: "Download failed", description: "Failed to generate timetable PDF", variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  }

  async function handleDownloadXlsx() {
    setIsExportingXlsx(true);
    try {
      const filename = `${fileBase}.xlsx`;
      await downloadSectionTimetableXlsx(
        {
          ...exportMeta,
          sectionName: section?.name,
          sectionYear: section?.year,
          batch: section?.batch,
        },
        filename
      );
      toast({ title: "Timetable exported", description: `Saved as ${filename}` });
    } catch (err) {
      console.error(err);
      toast({ title: "Export failed", description: "Failed to export timetable spreadsheet", variant: "destructive" });
    } finally {
      setIsExportingXlsx(false);
    }
  }

  function handlePrint() {
    const html = buildSectionTimetablePdfHtml(exportMeta);
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({ title: "Popup blocked", description: "Please allow popups to print the timetable", variant: "destructive" });
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 400);
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2.5">
        {showWeekNav && weekStart && onWeekChange ? (
          <WeekNavigator weekStart={weekStart} onChange={onWeekChange} />
        ) : (
          <div className="text-sm font-semibold text-foreground min-w-0 truncate">
            {[courseName || section?.courseName, departmentName || section?.department, section ? `Section ${section.name}` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {onTypeFilterChange && (
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium text-muted-foreground mr-1">Show:</span>
              {(["ALL", "THEORY", "PRACTICAL"] as const).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={typeFilter === t ? "default" : "outline"}
                  onClick={() => onTypeFilterChange(t)}
                  className="h-8 px-2.5 text-xs"
                >
                  {t === "ALL" ? "All" : t === "THEORY" ? "Theory" : "Practical"}
                </Button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadPdf}
              disabled={isExportingPdf || filteredSlots.length === 0}
              aria-label="Download timetable as PDF"
              className="h-8 gap-1.5 px-2 sm:px-2.5 text-xs"
            >
              {isExportingPdf ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">{isExportingPdf ? "Generating..." : "Download PDF"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadXlsx}
              disabled={isExportingXlsx || filteredSlots.length === 0}
              aria-label="Export timetable as Excel spreadsheet"
              className="h-8 gap-1.5 px-2 sm:px-2.5 text-xs"
            >
              {isExportingXlsx ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              )}
              <span className="hidden sm:inline">{isExportingXlsx ? "Exporting..." : "Export Excel"}</span>
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={handlePrint}
              disabled={filteredSlots.length === 0}
              aria-label="Print timetable"
              className="h-8 gap-1.5 px-2 sm:px-2.5 text-xs"
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Print</span>
            </Button>
          </div>
        </div>
      </div>

      {/* ── Institutional Card Header ───────────────────────────────────────── */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="border-b bg-muted/20 px-4 py-3 text-center sm:text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Same logo the PDF / spreadsheet letterhead uses: the college's own, else the Vishnu logo. */}
            <img
              src={resolveLogoUrl(logoUrl ?? collegeInfo?.logoUrl)}
              alt=""
              className="h-10 w-10 shrink-0 object-contain rounded border bg-background p-0.5"
            />
            <div className="min-w-0">
              <h3 className="text-sm font-bold tracking-wide uppercase text-foreground break-words">
                {activeCollegeName || (collegeLoading ? "Loading college…" : collegeFailed ? "College" : "Time Table")}
                {activeCollegeCode ? ` (Code: ${activeCollegeCode})` : ""}
              </h3>
              {activeAffiliation && (
                <p className="text-[11px] text-muted-foreground font-medium break-words">{activeAffiliation}</p>
              )}
              <p className="text-xs text-muted-foreground break-words">
                {[
                  departmentName || section?.department,
                  courseName || section?.courseName,
                  timing.year != null ? ordinalYear(timing.year) : undefined,
                  section ? `Section ${section.name}` : undefined,
                  classInchargeName && classInchargeName !== "—" ? `Incharge: ${classInchargeName}` : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-[11px] font-semibold text-primary/90 mt-0.5">
                {buildClassTimetableSubtitle({
                  academicYear,
                  semesterLabel,
                  effectiveDate: effectiveDateProp ?? latestEffectiveDate(filteredSlots),
                })}
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              {semesterLabel || "Time Table"}
            </p>
          </div>
        </div>

        {/* ── Mobile View Controls (phones & small screens) ── */}
        <div className="md:hidden p-2 bg-muted/40 border-b flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border p-0.5 bg-background shadow-2xs">
            <Button
              type="button"
              size="sm"
              variant={mobileViewMode === "matrix" ? "default" : "ghost"}
              className="h-7 text-[11px] font-semibold px-2.5 gap-1"
              onClick={() => setMobileViewMode("matrix")}
            >
              <LayoutGrid className="h-3 w-3" />
              <span>Compact</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mobileViewMode === "day" ? "default" : "ghost"}
              className="h-7 text-[11px] font-semibold px-2.5 gap-1"
              onClick={() => setMobileViewMode("day")}
            >
              <CalendarDays className="h-3 w-3" />
              <span>Day Tabs</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mobileViewMode === "list" ? "default" : "ghost"}
              className="h-7 text-[11px] font-semibold px-2.5 gap-1"
              onClick={() => setMobileViewMode("list")}
            >
              <ListFilter className="h-3 w-3" />
              <span>List</span>
            </Button>
          </div>
          <span className="text-[10px] text-muted-foreground font-medium">Tap cell for details</span>
        </div>

        {/* ── Mobile View Mode 1: Compact Short-Code Matrix (All Days x All Periods) ── */}
        {mobileViewMode === "matrix" && (
          <div className="md:hidden overflow-x-auto no-scrollbar">
            <table className="w-full text-xs border-collapse min-w-[340px]">
              <thead>
                <tr className="bg-muted/50 border-b text-[10px] font-bold text-muted-foreground">
                  <th className="p-1 text-center w-10 border-r sticky left-0 z-10 bg-muted/95">Day</th>
                  {columns.map((col) => {
                    if (col.kind === "break") {
                      return (
                        <th key={col.id} className="p-1 text-center border-r bg-muted/30 w-8">
                          {col.breakKind === "lunch" ? "L" : "B"}
                        </th>
                      );
                    }
                    return (
                      <th key={col.id} className="p-1 text-center border-r font-extrabold text-foreground min-w-[42px]">
                        P{col.periodNumber}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleDays.map((d) => (
                  <tr key={d} className="border-b hover:bg-muted/10">
                    <th scope="row" className="p-1 text-center font-bold text-[10px] border-r sticky left-0 z-10 bg-muted/90 uppercase">
                      {d.slice(0, 3)}
                    </th>
                    {columns.map((col) => {
                      if (col.kind === "break") {
                        return (
                          <td key={col.id} className="p-0.5 text-center border-r bg-muted/20 text-[9px] font-mono text-muted-foreground/60 select-none">
                            |
                          </td>
                        );
                      }
                      const periodSlots = cellEntries(filteredSlots.filter(
                        (s) => s.day === d && s.periodNumber === col.periodNumber
                      ));

                      if (periodSlots.length === 0) {
                        return (
                          <td key={col.id} className="p-1 text-center border-r text-[10px] text-muted-foreground/30 font-mono select-none">
                            —
                          </td>
                        );
                      }

                      return (
                        <td key={col.id} className="p-0.5 border-r align-top">
                          <div className="space-y-0.5">
                            {periodSlots.map((s, idx) => {
                              const shortCode = slotShortCode(s, subjectMap);
                              const isSub = Boolean(s.substituteFacultyName);
                              const isLab = isLabSlot(s, subjectMap);

                              return (
                                <button
                                  key={s.id || idx}
                                  type="button"
                                  onClick={() => setSelectedMobileSlot({ slot: s, day: d, col })}
                                  className={`w-full p-1 rounded border text-center transition-all focus:outline-none focus:ring-1 focus:ring-primary ${
                                    isSub
                                      ? "bg-amber-500/15 border-amber-500/30 text-amber-950 dark:text-amber-200 font-bold"
                                      : "bg-primary/10 border-primary/25 text-foreground font-bold"
                                  }`}
                                  aria-label={`${shortCode} details`}
                                >
                                  <div className="text-[10px] font-extrabold uppercase truncate leading-tight">
                                    {shortCode}
                                  </div>
                                  {s.labBatch && (
                                    <div className="text-[8px] font-semibold text-violet-700 dark:text-violet-300 leading-none">
                                      {s.labBatch}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Mobile View Mode 2: Day Tabs (Mon-Sat selector) ── */}
        {mobileViewMode === "day" && (
          <div className="md:hidden p-3 space-y-3">
            {/* Day selector pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
              {visibleDays.map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={activeMobileDayTab === d ? "default" : "outline"}
                  className="h-7 text-xs font-semibold px-2.5 shrink-0"
                  onClick={() => setActiveMobileDayTab(d)}
                >
                  {DAY_LABELS[d] || d}
                </Button>
              ))}
            </div>

            {/* Selected day's period list */}
            <div className="space-y-2">
              {columns.map((col) => {
                if (col.kind === "break") {
                  return (
                    <div key={col.id} className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      <span className="font-semibold uppercase tracking-wider text-[10px]">
                        {col.label} {periodTimeRange(col.startTime, col.endTime) && `(${periodTimeRange(col.startTime, col.endTime)})`}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  );
                }

                const periodSlots = cellEntries(filteredSlots.filter(
                  (s) => s.day === activeMobileDayTab && s.periodNumber === col.periodNumber
                ));

                return (
                  <div key={col.id} className="p-2.5 rounded-lg border bg-card flex items-start gap-3">
                    <div className="w-16 shrink-0 text-left">
                      <span className="font-bold text-xs text-foreground block">Period {col.periodNumber}</span>
                      {periodTimeRange(col.startTime, col.endTime) && (
                        <span className="text-[10px] text-muted-foreground block">{periodTimeRange(col.startTime, col.endTime)}</span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {periodSlots.length === 0 ? (
                        <span className="text-xs text-muted-foreground/40 font-mono">Free Period</span>
                      ) : (
                        <div className="space-y-1.5">
                          {periodSlots.map((s, idx) => {
                            const shortCode = slotShortCode(s, subjectMap);
                            const faculty = slotFacultyName(s);
                            const isLab = isLabSlot(s, subjectMap);

                            return (
                              <button
                                key={s.id || idx}
                                type="button"
                                onClick={() => setSelectedMobileSlot({ slot: s, day: activeMobileDayTab, col })}
                                className="w-full text-left p-2 rounded-md border bg-muted/20 hover:bg-muted/40 transition-colors"
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-bold text-xs text-foreground">{s.subjectName}</span>
                                  <Badge variant={isLab ? "secondary" : "outline"} className="text-[10px]">
                                    {shortCode}
                                  </Badge>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-1">
                                  {faculty && <span>Faculty: {faculty}</span>}
                                  {s.classroom && <span>· Room {s.classroom}</span>}
                                  {s.labBatch && <span className="font-semibold text-violet-600">· {s.labBatch}</span>}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Mobile View Mode 3: Full Vertical List View ── */}
        {mobileViewMode === "list" && (
          <div className="md:hidden divide-y divide-border">
            {visibleDays.map((d) => (
              <section key={d} aria-label={DAY_LABELS[d] ?? d}>
                <h4 className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wider text-foreground">
                  {DAY_LABELS[d] ?? d}
                </h4>
                <ul className="px-4 pb-3 space-y-1">
                  {columns.map((col) => {
                    if (col.kind === "break") {
                      return (
                        <li
                          key={col.id}
                          className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground"
                          aria-label={col.label}
                        >
                          <span className="h-px flex-1 bg-border" aria-hidden="true" />
                          <span className="shrink-0 font-medium">
                            {col.label}
                            {periodTimeRange(col.startTime, col.endTime) && ` · ${periodTimeRange(col.startTime, col.endTime)}`}
                          </span>
                          <span className="h-px flex-1 bg-border" aria-hidden="true" />
                        </li>
                      );
                    }

                    const periodSlots = cellEntries(filteredSlots.filter(
                      (s) => s.day === d && s.periodNumber === col.periodNumber
                    ));
                    const range = periodTimeRange(col.startTime, col.endTime);

                    return (
                      <li
                        key={col.id}
                        className="flex items-baseline gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40"
                      >
                        <span className="w-24 shrink-0 text-[11px] font-semibold text-muted-foreground">
                          Period {col.periodNumber}
                          {range && <span className="block font-normal">{range}</span>}
                        </span>
                        <div className="min-w-0 flex-1">
                          {periodSlots.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground/50">Free</span>
                          ) : (
                            periodSlots.map((s, idx) => {
                              const shortCode = slotShortCode(s, subjectMap);
                              const isSub = Boolean(s.substituteFacultyName);
                              const faculty = slotFacultyName(s);
                              return (
                                <p
                                  key={s.id || idx}
                                  className="text-xs text-foreground leading-snug cursor-pointer hover:underline"
                                  onClick={() => setSelectedMobileSlot({ slot: s, day: d, col })}
                                  title={`${s.subjectName}${faculty ? ` · ${faculty}` : ""}${s.classroom ? ` · Room ${s.classroom}` : ""}`}
                                >
                                  <span className="font-bold">{shortCode}</span>
                                  {s.labBatch && <span className="text-muted-foreground"> · {s.labBatch}</span>}
                                  {faculty && <span className="text-muted-foreground"> · {faculty}</span>}
                                  {isSub && <span className="text-amber-700 dark:text-amber-400 font-medium"> · Sub: {s.substituteFacultyName}</span>}
                                  {s.classroom && <span className="text-muted-foreground"> · Room {s.classroom}</span>}
                                </p>
                              );
                            })
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {/* ── Timetable Grid (Desktop & Tablet: NON-SCROLLABLE layout) ──────────────────────────────────── */}
        <div className="hidden md:block">
          <div className="w-full">
            {/* Table layout: table-fixed with proportional column widths so no horizontal scroll */}
            <table className="w-full table-fixed text-xs border-collapse">
              <colgroup>
                <col style={{ width: "65px" }} />
                {columns.map((col) => (
                  <col key={col.id} style={{ width: col.kind === "break" ? "40px" : "auto" }} />
                ))}
              </colgroup>
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="border-r p-2 text-center font-bold text-foreground w-[65px] sticky left-0 z-[5] bg-muted/95 backdrop-blur">
                    Day
                  </th>
                  {columns.map((col) => {
                    if (col.kind === "break") {
                      return (
                        <th
                          key={col.id}
                          className="border-r p-1 text-center font-semibold text-muted-foreground bg-muted/30 w-[40px]"
                        >
                          {periodTimeRange(col.startTime, col.endTime) && (
                            <div className="text-[9px] font-normal text-muted-foreground mt-0.5">
                              {periodTimeRange(col.startTime, col.endTime)}
                            </div>
                          )}
                        </th>
                      );
                    }

                    const range = periodTimeRange(col.startTime, col.endTime);
                    return (
                      <th
                        key={col.id}
                        className="border-r p-1.5 text-center font-bold text-foreground"
                      >
                        <div>P{col.periodNumber}</div>
                        {range && (
                          <div className="text-[9px] font-normal text-muted-foreground truncate mt-0.5" title={range}>
                            {range}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {days.map((d, dayIndex) => {
                  // Cells the user chose to merge in the editor are drawn as one wide cell.
                  const { spans, skipped } = continuousSpans(columns, (p) => filteredSlots.filter((s) => s.day === d && s.periodNumber === p));
                  return (
                    <tr key={d} className="border-b last:border-b-0 hover:bg-muted/10">
                      <td className="border-r p-2 text-center font-bold text-foreground sticky left-0 z-[5] backdrop-blur bg-muted/90">
                        {DAY_LABELS[d]?.slice(0, 3) ?? d}
                      </td>

                      {columns.map((col, colIdx) => {
                        // Swallowed by the wider cell to its left (see continuousSpans).
                        if (skipped.has(colIdx)) return null;
                        if (col.kind === "break") {
                          // One tall cell across every day row, titled vertically.
                          if (dayIndex > 0) return null;
                          return (
                            <td
                              key={col.id}
                              rowSpan={days.length}
                              className="border-r bg-muted/25 text-center align-middle w-[40px]"
                            >
                              <span className="inline-block text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground [writing-mode:vertical-rl] rotate-180">
                                {col.breakKind === "lunch" ? "Lunch Break" : "Short Break"}
                              </span>
                            </td>
                          );
                        }

                        const periodSlots = cellEntries(filteredSlots.filter(
                          (s) => s.day === d && s.periodNumber === col.periodNumber
                        ));

                        if (periodSlots.length === 0) {
                          return (
                            <td key={col.id} className="border-r p-1.5 text-center text-muted-foreground/30 font-mono">
                              —
                            </td>
                          );
                        }

                        return (
                          <td key={col.id} colSpan={spans.get(colIdx) ?? 1} className="border-r p-1 align-middle">
                            <div className="flex flex-col items-center justify-center gap-1">
                              {periodSlots.map((s, idx) => {
                                const shortCode = slotShortCode(s, subjectMap);
                                const isSub = Boolean(s.substituteFacultyName);
                                const faculty = slotFacultyName(s);

                                return (
                                  <div
                                    key={s.id || idx}
                                    onClick={() => setSelectedMobileSlot({ slot: s, day: d, col })}
                                    className={`w-full rounded px-1 py-1 text-center transition-all cursor-pointer ${
                                      isSub
                                        ? "bg-amber-100 text-amber-900 border border-amber-300"
                                        : "bg-primary/5 hover:bg-primary/10 border border-primary/20 text-foreground"
                                    }`}
                                    title={`${s.subjectName}${faculty ? ` · ${faculty}` : ""}${s.classroom ? ` · Room ${s.classroom}` : ""}`}
                                  >
                                    <div className="font-extrabold text-[10px] sm:text-[11px] tracking-wide text-foreground uppercase truncate">
                                      {shortCode}
                                    </div>
                                    {s.labBatch && (
                                      <div className="text-[8.5px] font-semibold text-muted-foreground truncate">{s.labBatch}</div>
                                    )}
                                    {faculty && (
                                      <div className="text-[9px] font-medium text-muted-foreground truncate max-w-full mx-auto mt-0.5">
                                        {faculty}
                                      </div>
                                    )}
                                    {isSub && (
                                      <div className="text-[8.5px] font-semibold text-amber-800 mt-0.5 truncate">
                                        Sub: {s.substituteFacultyName}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Allocation of Subjects ─────────────────────────────────────────── */}
        {allocationList.length > 0 && (
          <div className="border-t px-4 py-3 bg-card">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-1">
              Allocation of Subjects
            </h4>
            <ul className="divide-y divide-border">
              {allocationList.map((item, idx) => (
                <li key={idx} className="flex items-baseline gap-3 py-2 text-xs">
                  <span className="w-16 shrink-0 font-mono font-bold text-foreground text-[11px]">
                    {item.code}
                  </span>
                  <span className="min-w-0 flex-1 text-foreground">
                    {item.name}
                    {item.labBatches.length > 0 && (
                      <span className="text-muted-foreground"> ({item.labBatches.join(", ")})</span>
                    )}
                    <span className="text-muted-foreground"> · {item.faculty}</span>
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground text-[11px]">
                    {item.hoursPerWeek ?? "—"} hrs/wk
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Interactive Period Details Dialog ── */}
      <Dialog open={Boolean(selectedMobileSlot)} onOpenChange={(open) => !open && setSelectedMobileSlot(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 text-base">
              <span>Period Details</span>
              {selectedMobileSlot && isLabSlot(selectedMobileSlot.slot, subjectMap) && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <FlaskConical className="h-3.5 w-3.5" /> Practical / Lab
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedMobileSlot && DAY_LABELS[selectedMobileSlot.day]} · Period {selectedMobileSlot?.slot.periodNumber}
            </DialogDescription>
          </DialogHeader>

          {selectedMobileSlot && (
            <div className="space-y-4 pt-2">
              <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
                <p className="text-xs font-mono text-primary font-bold">
                  {readableCode(slotShortCode(selectedMobileSlot.slot, subjectMap), selectedMobileSlot.slot.subjectName) || slotShortCode(selectedMobileSlot.slot, subjectMap) || "Subject"}
                </p>
                <h3 className="font-bold text-base text-foreground leading-tight">
                  {selectedMobileSlot.slot.subjectName}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg border bg-card">
                  <span className="text-muted-foreground block text-[11px]">Timing</span>
                  <span className="font-semibold text-foreground text-sm">
                    {periodTimeRange(selectedMobileSlot.col.startTime, selectedMobileSlot.col.endTime) || `Period ${selectedMobileSlot.slot.periodNumber}`}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg border bg-card">
                  <span className="text-muted-foreground block text-[11px]">Classroom / Location</span>
                  <span className="font-semibold text-foreground text-sm">
                    {selectedMobileSlot.slot.classroom ? `Room ${selectedMobileSlot.slot.classroom}` : "To be announced"}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg border bg-card col-span-2">
                  <span className="text-muted-foreground block text-[11px]">Faculty In-Charge</span>
                  <p className="font-semibold text-foreground text-sm mt-0.5">
                    {slotFacultyName(selectedMobileSlot.slot) || "Not assigned yet"}
                  </p>
                  {selectedMobileSlot.slot.substituteFacultyName && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
                      Substitute: {selectedMobileSlot.slot.substituteFacultyName}
                    </p>
                  )}
                </div>

                {selectedMobileSlot.slot.labBatch && (
                  <div className="p-2.5 rounded-lg border bg-card col-span-2">
                    <span className="text-muted-foreground block text-[11px]">Lab Batch</span>
                    <span className="font-semibold text-foreground text-sm">{selectedMobileSlot.slot.labBatch}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
