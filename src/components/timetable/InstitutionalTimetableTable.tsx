"use client";

import { useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { WeekNavigator } from "@/components/timetable/WeekNavigator";
import {
  buildSectionTimetablePdfHtml,
  downloadTimetableAsXls,
} from "@/lib/timetable/sectionTimetablePdf";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import type {
  CourseYearTiming,
  DayOfWeek,
  PeriodTiming,
  Section,
  Subject,
  TeachingAssignment,
  TimetableSlot,
} from "@/types";
import { DAY_LABELS } from "@/types";

import { useCollegeInfo } from "@/hooks/useCollegeInfo";

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

const DAY_SHORT: Record<DayOfWeek, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
};

/** "09:00" -> "9:00 AM" */
function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

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
  courseName = section?.courseName ?? "Degree Program",
  departmentName = section?.department ?? "Department",
  collegeName,
  collegeCode,
  affiliation,
  address,
  phone,
  logoUrl,
  academicYear = slots[0]?.academicYear ?? "",
  semesterLabel,
  classroom,
  classInchargeName = section?.facultyInchargeName ?? "—",
  subjects = [],
  assignments = [],
  weekStart,
  onWeekChange,
  showWeekNav = false,
  typeFilter = "ALL",
  onTypeFilterChange,
  className = "",
}: InstitutionalTimetableTableProps) {
  const { collegeInfo } = useCollegeInfo();
  const activeCollegeName = collegeName || collegeInfo?.name || "College";
  const activeCollegeCode = collegeCode ?? (collegeInfo?.code || "");
  const activeAffiliation = affiliation ?? (collegeInfo?.affiliation || "");
  const activeAddress = address ?? (collegeInfo?.address || "");
  const activePhone = phone ?? (collegeInfo?.phone || "");
  const activeLogoUrl = logoUrl ?? (collegeInfo?.logoUrl || "");

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Filter slots if type filter is active
  const filteredSlots = useMemo(() => {
    if (typeFilter === "ALL") return slots;
    return slots.filter((s) => {
      const type = (s as any).subjectType;
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

  // Map subjects for quick lookup
  const subjectMap = useMemo(() => {
    const map = new Map<string, Subject>();
    for (const s of subjects) map.set(s.id, s);
    return map;
  }, [subjects]);

  // Periods array
  const periods = useMemo(
    () => Array.from({ length: timing.numberOfPeriods }, (_, i) => i + 1),
    [timing.numberOfPeriods]
  );

  // Period timings
  const timingByPeriod = useMemo(() => {
    const map = new Map<number, PeriodTiming>();
    for (const t of timing.periods ?? []) map.set(t.period, t);
    return map;
  }, [timing.periods]);

  // Break config
  const lunchAfter = timing.lunchBreak?.afterPeriod ?? (periods.length >= 6 ? 4 : Math.floor(periods.length / 2));
  const shortBreakAfters = useMemo(
    () => new Set(timing.shortBreaks?.map((b) => b.afterPeriod) ?? (periods.length >= 8 ? [2] : [])),
    [timing.shortBreaks, periods.length]
  );

  // Build grid columns definition
  interface GridColumn {
    id: string;
    kind: "period" | "break";
    periodNumber?: number;
    title: string;
    timeRange?: string;
    isLunch?: boolean;
  }

  const columns: GridColumn[] = useMemo(() => {
    const cols: GridColumn[] = [];

    for (const p of periods) {
      const t = timingByPeriod.get(p);
      const startStr = t ? formatTime12h(t.startTime) : "";
      const endStr = t ? formatTime12h(t.endTime) : "";
      const rangeStr = startStr && endStr ? `${startStr} - ${endStr}` : "";

      cols.push({
        id: `period_${p}`,
        kind: "period",
        periodNumber: p,
        title: `Period ${p}`,
        timeRange: rangeStr,
      });

      // Short break after this period
      if (shortBreakAfters.has(p)) {
        const nextT = timingByPeriod.get(p + 1);
        const bStart = endStr || "10:40 AM";
        const bEnd = nextT ? formatTime12h(nextT.startTime) : "11:00 AM";
        cols.push({
          id: `break_short_${p}`,
          kind: "break",
          title: "Tea Break",
          timeRange: `${bStart} - ${bEnd}`,
          isLunch: false,
        });
      }

      // Lunch break after this period
      if (p === lunchAfter) {
        const nextT = timingByPeriod.get(p + 1);
        const lStart = endStr || "12:40 PM";
        const lEnd = nextT ? formatTime12h(nextT.startTime) : "01:40 PM";
        cols.push({
          id: `break_lunch_${p}`,
          kind: "break",
          title: "Lunch Break",
          timeRange: `${lStart} - ${lEnd}`,
          isLunch: true,
        });
      }
    }

    return cols;
  }, [periods, timingByPeriod, shortBreakAfters, lunchAfter]);

  // Helper for short code: e.g. DWDM, FLAT, CN, etc.
  function getSlotShortCode(slot: TimetableSlot): string {
    const sObj = subjectMap.get(slot.subjectId);
    if (sObj?.shortCode) return sObj.shortCode;
    if (sObj?.code) return sObj.code;
    if ((slot as any).shortCode) return (slot as any).shortCode;
    if ((slot as any).subjectCode) return (slot as any).subjectCode;
    const name = slot.subjectName || "";
    if (name.length <= 10) return name.toUpperCase();
    return name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  // Deduplicated Allocation List
  const allocationList = useMemo(() => {
    const seen = new Set<string>();
    interface AllocEntry {
      code: string;
      name: string;
      faculty: string;
    }
    const list: AllocEntry[] = [];

    for (const slot of slots) {
      const key = slot.subjectId || slot.subjectName;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const sObj = subjectMap.get(slot.subjectId);
      const assign = assignments.find((a) => a.subjectId === slot.subjectId);

      const code = sObj?.shortCode ?? sObj?.code ?? getSlotShortCode(slot);
      const name = sObj?.name ?? slot.subjectName;
      const fac = (slot.facultyName ?? assign?.facultyName ?? "Unassigned").toUpperCase();

      list.push({ code, name, faculty: fac });
    }

    return list;
  }, [slots, subjectMap, assignments]);

  // Generate HTML options
  const pdfOpts = useMemo(() => {
    const calculatedBatch = `${new Date().getFullYear() - (timing.year - 1)}-${new Date().getFullYear() - (timing.year - 1) + 4}`;
    const dummySec = section ?? {
      id: "sec_1",
      collegeId: "col_1",
      department: departmentName,
      courseId: "c_1",
      courseName,
      name: "A",
      year: timing.year,
      batch: calculatedBatch,
      studentCount: 60,
    };
    return {
      collegeName: activeCollegeName,
      collegeCode: activeCollegeCode,
      affiliation: activeAffiliation,
      address: activeAddress,
      phone: activePhone,
      logoUrl: activeLogoUrl,
      courseName,
      departmentName,
      section: dummySec,
      days: DAYS,
      periods,
      periodTimings: timing.periods ?? [],
      slots,
      lunchBreak: timing.lunchBreak,
      shortBreaks: timing.shortBreaks,
      academicYear,
      semesterLabel,
      subjects,
      assignments,
    };
  }, [
    section,
    courseName,
    departmentName,
    activeCollegeName,
    activeCollegeCode,
    activeAffiliation,
    activeAddress,
    activePhone,
    activeLogoUrl,
    periods,
    timing,
    slots,
    academicYear,
    semesterLabel,
    subjects,
    assignments,
  ]);

  async function handleDownloadPdf() {
    setIsExportingPdf(true);
    try {
      const html = buildSectionTimetablePdfHtml(pdfOpts);
      const filename = `Timetable_${(courseName || "Class").replace(/\s+/g, "_")}_Sec_${section?.name ?? "Section"}.pdf`;
      await renderHtmlToPdf(html, filename);
      toast({ title: "Timetable downloaded", description: `Saved as ${filename}` });
    } catch (err) {
      console.error(err);
      toast({ title: "Download failed", description: "Failed to generate timetable PDF", variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  }

  function handleDownloadXls() {
    try {
      const html = buildSectionTimetablePdfHtml(pdfOpts);
      const filename = `Timetable_${(courseName || "Class").replace(/\s+/g, "_")}_Sec_${section?.name ?? "Section"}.xls`;
      downloadTimetableAsXls(html, filename);
      toast({ title: "Timetable exported", description: `Saved as ${filename}` });
    } catch (err) {
      console.error(err);
      toast({ title: "Export failed", description: "Failed to export timetable spreadsheet", variant: "destructive" });
    }
  }

  function handlePrint() {
    const html = buildSectionTimetablePdfHtml(pdfOpts);
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
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {showWeekNav && weekStart && onWeekChange ? (
          <WeekNavigator weekStart={weekStart} onChange={onWeekChange} />
        ) : (
          <div className="text-sm font-semibold text-foreground">
            {courseName} · {departmentName} {section ? `· Section ${section.name}` : ""}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {onTypeFilterChange && (
            <div className="flex items-center gap-1 mr-2">
              <span className="text-xs font-medium text-muted-foreground mr-1">Show:</span>
              {(["ALL", "THEORY", "PRACTICAL"] as const).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={typeFilter === t ? "default" : "outline"}
                  onClick={() => onTypeFilterChange(t)}
                  className="h-8 text-xs px-2.5"
                >
                  {t === "ALL" ? "All" : t === "THEORY" ? "Theory" : "Practical"}
                </Button>
              ))}
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={isExportingPdf || slots.length === 0}
            className="h-8 gap-1.5 text-xs"
          >
            {isExportingPdf ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileDown className="h-3.5 w-3.5" />
            )}
            <span>{isExportingPdf ? "Generating..." : "Download PDF"}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadXls}
            disabled={slots.length === 0}
            className="h-8 gap-1.5 text-xs"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>Export XLS</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handlePrint}
            disabled={slots.length === 0}
            className="h-8 gap-1.5 text-xs"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print</span>
          </Button>
        </div>
      </div>

      {/* ── Institutional Grid Table Card ───────────────────────────────────── */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        {/* Institutional Card Header */}
        <div className="border-b bg-muted/20 px-4 py-3 text-center sm:text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {activeLogoUrl && (
              <img
                src={activeLogoUrl}
                alt="Logo"
                className="h-10 w-10 object-contain rounded border bg-background p-0.5"
              />
            )}
            <div>
              <h3 className="text-sm font-bold tracking-wide uppercase text-foreground">
                {activeCollegeName} {activeCollegeCode ? `(Code: ${activeCollegeCode})` : ""}
              </h3>
              {activeAffiliation && (
                <p className="text-[11px] text-muted-foreground font-medium">
                  {activeAffiliation}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {departmentName} · {courseName} · Year {timing.year} {section ? `· Section ${section.name}` : ""}
                {classInchargeName && classInchargeName !== "—" ? ` · Incharge: ${classInchargeName}` : ""}
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-primary/10 text-primary uppercase tracking-wider">
              TIME TABLE
            </span>
          </div>
        </div>

        {/* Timetable Grid Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="border-r p-2.5 text-center font-bold text-foreground w-20 min-w-[70px]">
                  Day of<br />week
                </th>
                {columns.map((col) => {
                  if (col.kind === "break") {
                    return (
                      <th
                        key={col.id}
                        className="border-r p-2 text-center font-semibold text-muted-foreground bg-muted/30 min-w-[85px]"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {col.title}
                        </div>
                        {col.timeRange && (
                          <div className="text-[9.5px] font-normal text-muted-foreground whitespace-nowrap mt-0.5">
                            {col.timeRange}
                          </div>
                        )}
                      </th>
                    );
                  }

                  return (
                    <th
                      key={col.id}
                      className="border-r p-2 text-center font-bold text-foreground min-w-[105px]"
                    >
                      <div>{col.title}</div>
                      {col.timeRange && (
                        <div className="text-[9.5px] font-normal text-muted-foreground whitespace-nowrap mt-0.5">
                          {col.timeRange}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((d) => {
                const dayLabel = DAY_SHORT[d] ?? d;

                return (
                  <tr key={d} className="border-b last:border-b-0 hover:bg-muted/10 transition-colors">
                    <td className="border-r p-2.5 text-center font-bold text-foreground bg-muted/15">
                      {dayLabel}
                    </td>

                    {columns.map((col) => {
                      if (col.kind === "break") {
                        return (
                          <td
                            key={col.id}
                            className="border-r p-2 text-center bg-muted/25"
                          >
                            <span className="text-muted-foreground/40 font-mono select-none">—</span>
                          </td>
                        );
                      }

                      const periodSlots = filteredSlots.filter(
                        (s) => s.day === d && s.periodNumber === col.periodNumber
                      );

                      if (periodSlots.length === 0) {
                        return (
                          <td
                            key={col.id}
                            className="border-r p-2 text-center text-muted-foreground/30 font-mono"
                          >
                            —
                          </td>
                        );
                      }

                      return (
                        <td key={col.id} className="border-r p-2 text-center align-middle">
                          <div className="flex flex-col items-center justify-center gap-1">
                            {periodSlots.map((s, idx) => {
                              const shortCode = getSlotShortCode(s);
                              const isSub = Boolean(s.substituteFacultyName);

                              return (
                                <div
                                  key={s.id || idx}
                                  className={`w-full rounded px-1.5 py-1 text-center transition-all ${
                                    isSub
                                      ? "bg-amber-100 text-amber-900 border border-amber-300"
                                      : "bg-primary/5 hover:bg-primary/10 border border-primary/20 text-foreground"
                                  }`}
                                  title={`${s.subjectName}${s.facultyName ? ` · ${s.facultyName}` : ""}${s.classroom ? ` · Room ${s.classroom}` : ""}`}
                                >
                                  <div className="font-extrabold text-[11px] tracking-wide text-foreground uppercase">
                                    {shortCode}
                                  </div>
                                  {s.facultyName && (
                                    <div className="text-[9.5px] font-medium text-muted-foreground truncate max-w-[95px] mx-auto mt-0.5">
                                      {s.facultyName}
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

        {/* ── Allocation of Subjects Section ─────────────────────────────────── */}
        {allocationList.length > 0 && (
          <div className="border-t p-4 bg-card">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3 text-center sm:text-left">
              Allocation of Subjects
            </h4>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b text-muted-foreground font-semibold">
                    <th className="p-2 text-left w-24 border-r">Subject Code</th>
                    <th className="p-2 text-left border-r">Subject</th>
                    <th className="p-2 text-left border-r">Name of Faculty</th>
                    <th className="p-2 text-center w-28">Faculty Initials</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationList.map((item, idx) => (
                    <tr key={idx} className="border-b last:border-b-0 hover:bg-muted/15">
                      <td className="p-2 font-bold text-foreground border-r">{item.code}</td>
                      <td className="p-2 text-foreground border-r">{item.name}</td>
                      <td className="p-2 text-muted-foreground font-medium border-r">{item.faculty}</td>
                      <td className="p-2 text-center text-muted-foreground/30 font-mono">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
