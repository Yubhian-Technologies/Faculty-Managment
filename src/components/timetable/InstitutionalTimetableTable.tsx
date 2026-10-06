"use client";

import { useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { WeekNavigator } from "@/components/timetable/WeekNavigator";
import { buildSectionTimetablePdfHtml } from "@/lib/timetable/sectionTimetablePdf";
import { downloadSectionTimetableXlsx } from "@/lib/timetable/timetableExport";
import { resolveLogoUrl } from "@/lib/timetable/logoAsset";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { yearSemesterLabelIn } from "@/lib/academic/format";
import {
  buildAllocationList,
  buildTimetableColumns,
  ordinalYear,
  periodTimeRange,
  resolveTimetableDays,
  slotFacultyName,
  slotShortCode,
  type TimetableColumn, mergeCoTaughtSlots,} from "@/lib/timetable/gridModel";
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

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);

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
      section, classroom, classInchargeName, visibleDays, timing, filteredSlots, subjects, assignments,
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
            </div>
          </div>
          <div className="shrink-0">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              {semesterLabel || "Time Table"}
            </p>
          </div>
        </div>

        {/* ── Week view: day-by-day sections, fully visible, no scrolling ───── */}
        <div className="lg:hidden divide-y divide-border">
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

                  // Faculty of one subject sharing the period show as one entry, subject once.
                  const periodSlots = mergeCoTaughtSlots(filteredSlots.filter(
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
                                className="text-xs text-foreground leading-snug"
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

        {/* ── Timetable Grid (wide screens) ──────────────────────────────────── */}
        <div className="hidden lg:block">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="border-r p-2.5 text-center font-bold text-foreground w-20 min-w-[70px] sticky left-0 z-[5] bg-muted/95 backdrop-blur">
                    Day of<br />week
                  </th>
                  {columns.map((col) => {
                    if (col.kind === "break") {
                      return (
                        <th
                          key={col.id}
                          className="border-r p-2 text-center font-semibold text-muted-foreground bg-muted/30 w-12"
                        >
                          {periodTimeRange(col.startTime, col.endTime) && (
                            <div className="text-[9.5px] font-normal text-muted-foreground whitespace-nowrap mt-0.5">
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
                        className="border-r p-2 text-center font-bold text-foreground min-w-[92px]"
                      >
                        <div>Period {col.periodNumber}</div>
                        {range && (
                          <div className="text-[9.5px] font-normal text-muted-foreground whitespace-nowrap mt-0.5">
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
                  return (
                    <tr key={d} className="border-b last:border-b-0 hover:bg-muted/10">
                      <td className="border-r p-2.5 text-center font-bold text-foreground sticky left-0 z-[5] backdrop-blur bg-muted/90">
                        {DAY_LABELS[d]?.slice(0, 3) ?? d}
                      </td>

                      {columns.map((col) => {
                        if (col.kind === "break") {
                          // One tall cell across every day row, titled vertically.
                          if (dayIndex > 0) return null;
                          return (
                            <td
                              key={col.id}
                              rowSpan={days.length}
                              className="border-r bg-muted/25 text-center align-middle w-12"
                            >
                              <span className="inline-block text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground [writing-mode:vertical-rl] rotate-180">
                                {col.breakKind === "lunch" ? "Lunch Break" : "Short Break"}
                              </span>
                            </td>
                          );
                        }

                        const periodSlots = mergeCoTaughtSlots(filteredSlots.filter(
                          (s) => s.day === d && s.periodNumber === col.periodNumber
                        ));

                        if (periodSlots.length === 0) {
                          return (
                            <td key={col.id} className="border-r p-2 text-center text-muted-foreground/30 font-mono">
                              —
                            </td>
                          );
                        }

                        return (
                          <td key={col.id} className="border-r p-2 text-center align-middle">
                            <div className="flex flex-col items-center justify-center gap-1">
                              {periodSlots.map((s, idx) => {
                                const shortCode = slotShortCode(s, subjectMap);
                                const isSub = Boolean(s.substituteFacultyName);
                                const faculty = slotFacultyName(s);

                                return (
                                  <div
                                    key={s.id || idx}
                                    className={`w-full rounded px-1.5 py-1 text-center transition-all ${
                                      isSub
                                        ? "bg-amber-100 text-amber-900 border border-amber-300"
                                        : "bg-primary/5 hover:bg-primary/10 border border-primary/20 text-foreground"
                                    }`}
                                    title={`${s.subjectName}${faculty ? ` · ${faculty}` : ""}${s.classroom ? ` · Room ${s.classroom}` : ""}`}
                                  >
                                    <div className="font-extrabold text-[11px] tracking-wide text-foreground uppercase">
                                      {shortCode}
                                    </div>
                                    {s.labBatch && (
                                      <div className="text-[9px] font-semibold text-muted-foreground">{s.labBatch}</div>
                                    )}
                                    {faculty && (
                                      <div className="text-[9.5px] font-medium text-muted-foreground truncate max-w-[95px] mx-auto mt-0.5">
                                        {faculty}
                                      </div>
                                    )}
                                    {isSub && (
                                      <div className="text-[9px] font-semibold text-amber-800 mt-0.5">
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
    </div>
  );
}
