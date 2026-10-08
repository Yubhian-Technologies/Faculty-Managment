"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  MapPin,
  User,
  UserCheck,
  FlaskConical,
  BookOpen,
  Filter,
  Sparkles,
  Info,
  CalendarDays,
  LayoutGrid,
  ListFilter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";
import {
  buildTimetableColumns,
  periodTimeRange,
  readableCode,
  resolveTimetableDays,
  slotFacultyName,
  slotShortCode,
  type TimetableColumn, mergeCoTaughtSlots,} from "@/lib/timetable/gridModel";
import { toRoman } from "@/lib/academic/format";
import { getISTParts, istTimeHHMM } from "@/lib/attendance/istTime";
import type {
  CourseYearTiming,
  DayOfWeek,
  Section,
  Subject,
  TeachingAssignment,
  TimetableSlot,
  SubjectType,
} from "@/types";
import { DAY_LABELS } from "@/types";

type TimetableSlotRow = TimetableSlot & {
  id?: string;
  subjectType?: SubjectType;
  subjectCode?: string;
  shortCode?: string;
};

export interface WeeklyTimetableMatrixProps {
  section?: Section | null;
  timing: CourseYearTiming;
  slots: TimetableSlotRow[];
  workingDays?: DayOfWeek[];
  subjects?: Subject[];
  assignments?: TeachingAssignment[];
  selectedSemester?: number | null;
  className?: string;
  defaultView?: "grid" | "day";
}

function getTodayISTDayOfWeek(): DayOfWeek | null {
  const { year, month, day } = getISTParts();
  const date = new Date(year, month - 1, day);
  const dayIndex = date.getDay(); // 0 = Sun, 1 = Mon ...
  const map: Record<number, DayOfWeek> = {
    1: "MON",
    2: "TUE",
    3: "WED",
    4: "THU",
    5: "FRI",
    6: "SAT",
  };
  return map[dayIndex] ?? null;
}

export function WeeklyTimetableMatrix({
  section,
  timing,
  slots,
  workingDays,
  subjects = [],
  assignments = [],
  selectedSemester,
  className = "",
  defaultView = "grid",
}: WeeklyTimetableMatrixProps) {
  const [viewMode, setViewMode] = useState<"grid" | "day">(defaultView);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [batchFilter, setBatchFilter] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<TimetableSlotRow | null>(null);
  const [selectedSlotCol, setSelectedSlotCol] = useState<TimetableColumn | null>(null);
  const [selectedSlotDay, setSelectedSlotDay] = useState<DayOfWeek | null>(null);

  // Live IST period detection
  const todayDay = useMemo(() => getTodayISTDayOfWeek(), []);
  const [activeDayTab, setActiveDayTab] = useState<DayOfWeek>(todayDay || "MON");
  const [currentPeriodNumber, setCurrentPeriodNumber] = useState<number | null>(null);

  // Subject lookup
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  // Timetable days & columns
  const visibleDays = useMemo(() => {
    const occupied = new Set(slots.map((s) => s.day));
    return resolveTimetableDays({ workingDays }, occupied);
  }, [workingDays, slots]);

  const columns = useMemo(() => buildTimetableColumns(timing), [timing]);

  // Check which period is LIVE NOW in IST
  useEffect(() => {
    function checkCurrentPeriod() {
      const nowHHMM = istTimeHHMM();
      let matched: number | null = null;
      if (timing.periods) {
        for (const p of timing.periods) {
          if (nowHHMM >= p.startTime && nowHHMM <= p.endTime) {
            matched = p.period;
            break;
          }
        }
      }
      setCurrentPeriodNumber(matched);
    }

    checkCurrentPeriod();
    const interval = setInterval(checkCurrentPeriod, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [timing]);

  // Filter slots
  function isTheory(s: TimetableSlotRow): boolean {
    if (s.subjectType === "THEORY") return true;
    if (s.subjectType === "PRACTICAL" || s.labBatch) return false;
    const name = (s.subjectName || "").toLowerCase();
    return !name.includes("lab") && !name.includes("practical");
  }

  function isPractical(s: TimetableSlotRow): boolean {
    if (s.subjectType === "PRACTICAL" || s.labBatch) return true;
    if (s.subjectType === "THEORY") return false;
    const name = (s.subjectName || "").toLowerCase();
    return name.includes("lab") || name.includes("practical");
  }

  const batchOptions = useMemo(
    () => Array.from(new Set(slots.map((s) => s.labBatch).filter((b): b is string => !!b))),
    [slots]
  );

  const filteredSlots = useMemo(() => {
    return slots.filter((s) => {
      if (typeFilter === "THEORY" && !isTheory(s)) return false;
      if (typeFilter === "PRACTICAL" && !isPractical(s)) return false;
      if (batchFilter && s.labBatch !== batchFilter) return false;
      return true;
    });
  }, [slots, typeFilter, batchFilter]);

  // Period timings map for quick lookup
  const periodTimingsMap = useMemo(() => {
    const map = new Map<number, { startTime: string; endTime: string }>();
    if (timing.periods) {
      for (const p of timing.periods) {
        map.set(p.period, { startTime: p.startTime, endTime: p.endTime });
      }
    }
    return map;
  }, [timing]);

  // Open slot details dialog
  function openSlotDetails(slot: TimetableSlotRow, day: DayOfWeek, col: TimetableColumn) {
    setSelectedSlot(slot);
    setSelectedSlotDay(day);
    setSelectedSlotCol(col);
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* ── Control Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-xl border bg-card/70 shadow-xs">
        {/* View Mode Toggle: Grid vs Day Carousel */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5 bg-muted/40">
            <Button
              type="button"
              size="sm"
              variant={viewMode === "grid" ? "default" : "ghost"}
              className="h-8 text-xs font-semibold px-3 gap-1.5"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Week Matrix</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === "day" ? "default" : "ghost"}
              className="h-8 text-xs font-semibold px-3 gap-1.5"
              onClick={() => setViewMode("day")}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Day View</span>
            </Button>
          </div>

          {todayDay && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setActiveDayTab(todayDay);
                if (viewMode === "day") {
                  // already in day mode
                }
              }}
              className="h-8 text-xs px-2.5 gap-1.5 border-dashed"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="hidden sm:inline">Today ({DAY_LABELS[todayDay]?.slice(0, 3)})</span>
              <span className="sm:hidden">Today</span>
            </Button>
          )}
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border p-0.5 bg-muted/30">
            {(["ALL", "THEORY", "PRACTICAL"] as const).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={typeFilter === t ? "secondary" : "ghost"}
                className={`h-7 text-xs px-2.5 font-medium transition-all ${
                  typeFilter === t ? "shadow-2xs font-semibold" : "text-muted-foreground"
                }`}
                onClick={() => setTypeFilter(t)}
              >
                {t === "ALL" ? "All" : t === "THEORY" ? "Theory" : "Lab"}
              </Button>
            ))}
          </div>

          {batchOptions.length > 0 && (
            <Select
              value={batchFilter || "__all__"}
              onValueChange={(v) => setBatchFilter(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="h-7.5 text-xs w-28">
                <SelectValue placeholder="Batch: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Batches</SelectItem>
                {batchOptions.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ── Mode 1: Interactive Full-Week Matrix Grid ── */}
      {viewMode === "grid" && (
        <div className="rounded-xl border bg-card shadow-xs overflow-hidden">
          {/* Container with responsive non-scrollable layout on desktop */}
          <div className="overflow-x-auto md:overflow-x-visible relative no-scrollbar">
            <table className="w-full table-fixed text-xs border-collapse" role="grid" aria-label="Weekly Timetable Matrix">
              <colgroup>
                <col style={{ width: "65px" }} />
                {columns.map((col) => (
                  <col key={col.id} style={{ width: col.kind === "break" ? "40px" : "auto" }} />
                ))}
              </colgroup>
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="border-r p-2 text-center font-bold text-foreground w-[65px] sticky left-0 z-10 bg-muted/95 backdrop-blur shadow-xs">
                    Day
                  </th>
                  {columns.map((col) => {
                    if (col.kind === "break") {
                      return (
                        <th
                          key={col.id}
                          className="border-r p-1 text-center font-semibold text-muted-foreground bg-muted/20 w-[40px]"
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {col.breakKind === "lunch" ? "L" : "B"}
                          </div>
                          {periodTimeRange(col.startTime, col.endTime) && (
                            <div className="text-[9px] font-normal text-muted-foreground/80 mt-0.5 truncate" title={periodTimeRange(col.startTime, col.endTime)}>
                              {periodTimeRange(col.startTime, col.endTime)}
                            </div>
                          )}
                        </th>
                      );
                    }

                    const isLivePeriod = todayDay && currentPeriodNumber === col.periodNumber;

                    return (
                      <th
                        key={col.id}
                        className={`border-r p-1.5 text-center transition-colors ${
                          isLivePeriod ? "bg-primary/10 border-b-2 border-b-primary font-bold text-primary" : "text-foreground"
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span className="font-bold">P{col.periodNumber}</span>
                          {isLivePeriod && (
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping inline-block" title="Live Now" />
                          )}
                        </div>
                        {periodTimeRange(col.startTime, col.endTime) && (
                          <div className="text-[9px] font-normal text-muted-foreground mt-0.5 truncate" title={periodTimeRange(col.startTime, col.endTime)}>
                            {periodTimeRange(col.startTime, col.endTime)}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleDays.map((d, dayIndex) => {
                  const isToday = d === todayDay;
                  return (
                    <tr
                      key={d}
                      className={`border-b transition-colors hover:bg-muted/25 ${
                        isToday ? "bg-primary/5 dark:bg-primary/10" : ""
                      }`}
                    >
                      {/* Sticky Day Column */}
                      <th
                        scope="row"
                        className={`border-r p-2 text-center font-bold sticky left-0 z-10 backdrop-blur shadow-xs ${
                          isToday
                            ? "bg-primary text-primary-foreground font-extrabold"
                            : "bg-muted/80 text-foreground"
                        }`}
                      >
                        <div className="text-xs uppercase tracking-wider">{d.slice(0, 3)}</div>
                        {isToday && (
                          <span className="inline-block mt-0.5 text-[8px] font-bold px-1 py-0.2 rounded-full bg-primary-foreground text-primary leading-tight">
                            Today
                          </span>
                        )}
                      </th>

                      {/* Period Cells */}
                      {columns.map((col) => {
                        if (col.kind === "break") {
                          // One tall cell across every day row, titled vertically.
                          if (dayIndex > 0) return null;
                          return (
                            <td
                              key={col.id}
                              rowSpan={visibleDays.length}
                              className="border-r p-1 text-center align-middle bg-muted/15 w-[40px] select-none"
                              aria-label={col.label}
                            >
                              <span className="inline-block text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground [writing-mode:vertical-rl] rotate-180">
                                {col.breakKind === "lunch" ? "Lunch Break" : "Short Break"}
                              </span>
                            </td>
                          );
                        }

                        // Faculty of one subject sharing the period show as one entry, subject once.
                        const cellSlots = mergeCoTaughtSlots(filteredSlots.filter(
                          (s) => s.day === d && s.periodNumber === col.periodNumber
                        ));
                        const isLiveCell = isToday && currentPeriodNumber === col.periodNumber;

                        if (cellSlots.length === 0) {
                          return (
                            <td
                              key={col.id}
                              className={`border-r p-1 text-center text-muted-foreground/40 text-[11px] ${
                                isLiveCell ? "bg-emerald-500/10 ring-1 ring-emerald-500/40" : ""
                              }`}
                            >
                              <span className="select-none font-mono text-[10px]">—</span>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={col.id}
                            className={`border-r p-1 align-top transition-colors ${
                              isLiveCell ? "bg-emerald-500/10 ring-2 ring-emerald-500/50" : ""
                            }`}
                          >
                            <div className="space-y-1">
                              {cellSlots.map((s, idx) => {
                                const shortCode = slotShortCode(s, subjectMap);
                                const isSub = Boolean(s.substituteFacultyName);
                                const isLab = isPractical(s);
                                const faculty = slotFacultyName(s);

                                return (
                                  <button
                                    key={s.id || idx}
                                    type="button"
                                    onClick={() => openSlotDetails(s, d, col)}
                                    className={`w-full text-left p-1 sm:p-1.5 rounded-md border transition-all text-xs focus:outline-none focus:ring-1 focus:ring-primary ${
                                      isLab
                                        ? "bg-purple-500/15 border-purple-500/40 hover:bg-purple-500/25 text-purple-950 dark:text-purple-200 font-extrabold shadow-2xs"
                                        : isSub
                                        ? "bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 text-amber-950 dark:text-amber-200"
                                        : "bg-background hover:bg-muted/40 border-border text-foreground"
                                    }`}
                                    aria-label={`${shortCode} on ${DAY_LABELS[d]} Period ${col.periodNumber}`}
                                  >
                                    <div className="flex items-center justify-between gap-0.5">
                                      <span className="font-extrabold text-[10px] sm:text-xs truncate uppercase">{shortCode}</span>
                                      {isLab && (
                                        <FlaskConical className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                      )}
                                    </div>

                                    {s.labBatch && (
                                      <p className="text-[9px] font-semibold text-emerald-700 dark:text-emerald-300 truncate">
                                        {s.labBatch}
                                      </p>
                                    )}

                                    {faculty && (
                                      <p className="text-[9.5px] text-muted-foreground truncate mt-0.5 hidden sm:block">
                                        {faculty}
                                      </p>
                                    )}

                                    {s.classroom && (
                                      <div className="hidden sm:flex items-center gap-0.5 text-[9px] text-muted-foreground/80 mt-0.5">
                                        <MapPin className="h-2 w-2 shrink-0" />
                                        <span className="truncate">{s.classroom}</span>
                                      </div>
                                    )}

                                    {isLiveCell && (
                                      <div className="mt-0.5 pt-0.5 border-t border-emerald-500/20 flex items-center gap-1 text-[8px] font-bold text-emerald-600 dark:text-emerald-400">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        <span>LIVE</span>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Mode 2: Accessible Day-by-Day Carousel / List ── */}
      {viewMode === "day" && (
        <div className="space-y-4">
          {/* Day Selector Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {visibleDays.map((d) => {
              const isSelected = activeDayTab === d;
              const isToday = d === todayDay;
              const daySlotCount = filteredSlots.filter((s) => s.day === d).length;

              return (
                <Button
                  key={d}
                  type="button"
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveDayTab(d)}
                  className={`h-9 px-3 shrink-0 flex items-center gap-1.5 text-xs font-semibold ${
                    isSelected ? "shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{DAY_LABELS[d]}</span>
                  {isToday && (
                    <span className="text-[9px] px-1 py-0.2 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold">
                      Today
                    </span>
                  )}
                  <span className="text-[10px] opacity-75">({daySlotCount})</span>
                </Button>
              );
            })}
          </div>

          {/* Day's Periods Schedule */}
          {(() => {
            const currentDaySlots = filteredSlots
              .filter((s) => s.day === activeDayTab)
              .sort((a, b) => a.periodNumber - b.periodNumber);

            if (currentDaySlots.length === 0) {
              return (
                <div className="rounded-xl border border-dashed p-8 text-center bg-muted/10 space-y-2">
                  <Calendar className="h-8 w-8 mx-auto text-muted-foreground/40" />
                  <p className="text-sm font-semibold text-foreground">
                    No classes scheduled for {DAY_LABELS[activeDayTab]}
                  </p>
                  <p className="text-xs text-muted-foreground">Enjoy your free time or prepare for upcoming classes.</p>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {currentDaySlots.map((slot) => {
                  const periodTime = periodTimingsMap.get(slot.periodNumber);
                  const isLive = activeDayTab === todayDay && currentPeriodNumber === slot.periodNumber;
                  const isLab = isPractical(slot);
                  const isSub = Boolean(slot.substituteFacultyName);

                  return (
                    <div
                      key={slot.id}
                      onClick={() => {
                        const col = columns.find((c) => c.kind === "period" && c.periodNumber === slot.periodNumber);
                        if (col) openSlotDetails(slot, activeDayTab, col);
                      }}
                      className={`cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md flex flex-col justify-between gap-3 ${
                        isLive
                          ? "bg-emerald-500/10 border-emerald-500/50 ring-2 ring-emerald-500/40"
                          : isLab
                          ? "bg-emerald-500/5 border-emerald-500/20"
                          : isSub
                          ? "bg-amber-500/5 border-amber-500/30"
                          : "bg-card border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                          <span>Period {slot.periodNumber}</span>
                          {periodTime && (
                            <span className="font-normal text-muted-foreground/80">
                              · {formatTime12h(periodTime.startTime)} – {formatTime12h(periodTime.endTime)}
                            </span>
                          )}
                        </span>
                        {isLive ? (
                          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 text-[10px] font-bold animate-pulse">
                            LIVE NOW
                          </Badge>
                        ) : isLab ? (
                          <Badge variant="secondary" className="text-[10px] gap-1 font-semibold">
                            <FlaskConical className="h-3 w-3" /> Lab
                          </Badge>
                        ) : null}
                      </div>

                      <div className="space-y-1">
                        <h4 className="font-bold text-sm text-foreground leading-snug">
                          {slot.subjectName}
                        </h4>
                        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                          {slot.subjectCode && <span>{readableCode(slot.subjectCode, slot.subjectName)}</span>}
                          {slot.labBatch && (
                            <span className="font-sans font-semibold text-emerald-600 dark:text-emerald-400">
                              · {slot.labBatch}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5 truncate">
                          {isSub ? (
                            <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                              <UserCheck className="h-3.5 w-3.5" />
                              <span className="truncate">Sub: {slot.substituteFacultyName}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <User className="h-3.5 w-3.5" />
                              <span className="truncate">{slot.facultyName || "Not assigned"}</span>
                            </div>
                          )}
                        </div>
                        {slot.classroom && (
                          <div className="flex items-center gap-1 shrink-0 font-medium text-[11px]">
                            <MapPin className="h-3 w-3" />
                            <span>{slot.classroom}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Interactive Period Details Dialog ── */}
      <Dialog open={Boolean(selectedSlot)} onOpenChange={(open) => !open && setSelectedSlot(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 text-base">
              <span>Class Details</span>
              {selectedSlot && isPractical(selectedSlot) && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <FlaskConical className="h-3.5 w-3.5" /> Practical / Lab
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedSlotDay && DAY_LABELS[selectedSlotDay]} · Period {selectedSlot?.periodNumber}
            </DialogDescription>
          </DialogHeader>

          {selectedSlot && (
            <div className="space-y-4 pt-2">
              <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
                <p className="text-xs font-mono text-primary font-bold">
                  {readableCode(selectedSlot.shortCode, selectedSlot.subjectName) || readableCode(selectedSlot.subjectCode, selectedSlot.subjectName) || "Subject"}
                </p>
                <h3 className="font-bold text-base text-foreground leading-tight">
                  {selectedSlot.subjectName}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg border bg-card col-span-2">
                  <span className="text-muted-foreground block text-[11px]">Timing</span>
                  {selectedSlotCol && periodTimeRange(selectedSlotCol.startTime, selectedSlotCol.endTime) ? (
                    <span className="font-semibold text-foreground text-sm">
                      {periodTimeRange(selectedSlotCol.startTime, selectedSlotCol.endTime)}
                    </span>
                  ) : (
                    <span className="font-medium text-foreground">Standard Period</span>
                  )}
                </div>


                <div className="p-2.5 rounded-lg border bg-card col-span-2">
                  <span className="text-muted-foreground block text-[11px]">Faculty In-Charge</span>
                  <p className="font-semibold text-foreground text-sm mt-0.5">
                    {selectedSlot.facultyName || "Not assigned yet"}
                  </p>
                  {selectedSlot.substituteFacultyName && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
                      Substitute: {selectedSlot.substituteFacultyName}
                    </p>
                  )}
                </div>

                {selectedSlot.labBatch && (
                  <div className="p-2.5 rounded-lg border bg-card col-span-2">
                    <span className="text-muted-foreground block text-[11px]">Lab Batch</span>
                    <span className="font-semibold text-foreground text-sm">{selectedSlot.labBatch}</span>
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
