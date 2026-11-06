import { isLateCheckIn } from "@/lib/attendance/lateStatus";

// Pure counting for the Principal / VP dashboard. It reads the SAME answers the full report pages show
// (the faculty attendance roster, the not-posted rows), so a dashboard number always matches the
// page it opens.

export interface RosterRow {
  department: string;
  role: string;
  status: string;
  checkIn: string | null;
  permittedCheckInTime: string | null;
}

export interface FacultyToday {
  total: number;
  present: number;
  late: number;
  onLeave: number;
  onDuty: number;
  halfDay: number;
  absent: number;
  notIn: number;
  /** Not counted as expected today (holiday / weekend for them). */
  off: number;
  /** Present (incl. late, half day, on duty) out of those expected today; null when nobody is expected. */
  pct: number | null;
  departments: { department: string; total: number; present: number; pct: number | null }[];
}

const isIn = (s: string) => s === "PRESENT" || s === "HALF_DAY" || s === "ON_DUTY";

/** Faculty only (not College Staff). Expected today = everyone except those on leave or off. */
export function summarizeFacultyToday(roster: RosterRow[]): FacultyToday {
  const rows = roster.filter((r) => r.role !== "COLLEGE_STAFF");
  const t = { total: rows.length, present: 0, late: 0, onLeave: 0, onDuty: 0, halfDay: 0, absent: 0, notIn: 0, off: 0 };
  const byDept = new Map<string, { total: number; present: number; expected: number }>();
  for (const r of rows) {
    const d = byDept.get(r.department || "Not set") ?? { total: 0, present: 0, expected: 0 };
    d.total++;
    if (r.status === "PRESENT") { t.present++; if (isLateCheckIn(r.checkIn, r.permittedCheckInTime)) t.late++; }
    else if (r.status === "HALF_DAY") t.halfDay++;
    else if (r.status === "ON_DUTY") t.onDuty++;
    else if (r.status === "ON_LEAVE") t.onLeave++;
    else if (r.status === "ABSENT") t.absent++;
    else if (r.status === "HOLIDAY" || r.status === "WEEKEND") t.off++;
    else t.notIn++;
    const expected = r.status !== "ON_LEAVE" && r.status !== "HOLIDAY" && r.status !== "WEEKEND";
    if (expected) d.expected++;
    if (isIn(r.status)) d.present++;
    byDept.set(r.department || "Not set", d);
  }
  const expected = t.total - t.onLeave - t.off;
  const inToday = t.present + t.halfDay + t.onDuty;
  return {
    ...t,
    pct: expected > 0 ? Math.round((inToday / expected) * 100) : null,
    departments: [...byDept.entries()]
      .map(([department, d]) => ({ department, total: d.total, present: d.present, pct: d.expected > 0 ? Math.round((d.present / d.expected) * 100) : null }))
      .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.department.localeCompare(b.department)),
  };
}

export interface NotPostedRow {
  department: string;
  totalPeriods: number;
  onTime: number;
  late: number;
  notMarked: number;
  pending: number;
}

export interface ClassesToday {
  periods: number;
  /** Periods whose time has ended (posted or not). */
  ended: number;
  onTime: number;
  late: number;
  notPosted: number;
  upcoming: number;
  facultyNotPosted: number;
  /** Posted out of ended; null before any period has ended. */
  pct: number | null;
  departments: { department: string; notPosted: number; ended: number }[];
}

export function summarizeClassesToday(rows: NotPostedRow[]): ClassesToday {
  const c = { periods: 0, onTime: 0, late: 0, notPosted: 0, upcoming: 0, facultyNotPosted: 0 };
  const byDept = new Map<string, { notPosted: number; ended: number }>();
  for (const r of rows) {
    c.periods += r.totalPeriods; c.onTime += r.onTime; c.late += r.late; c.notPosted += r.notMarked; c.upcoming += r.pending;
    if (r.notMarked > 0) c.facultyNotPosted++;
    const d = byDept.get(r.department || "Not set") ?? { notPosted: 0, ended: 0 };
    d.notPosted += r.notMarked; d.ended += r.totalPeriods - r.pending;
    byDept.set(r.department || "Not set", d);
  }
  const ended = c.periods - c.upcoming;
  return {
    ...c, ended,
    pct: ended > 0 ? Math.round(((c.onTime + c.late) / ended) * 100) : null,
    departments: [...byDept.entries()].map(([department, d]) => ({ department, ...d }))
      .filter((d) => d.ended > 0).sort((a, b) => b.notPosted - a.notPosted || a.department.localeCompare(b.department)),
  };
}

/** green >= good, amber >= watch, red below - for a percentage that should be high. */
export function pctTone(pct: number | null, good = 90, watch = 75): "good" | "watch" | "bad" | "none" {
  if (pct === null) return "none";
  return pct >= good ? "good" : pct >= watch ? "watch" : "bad";
}
