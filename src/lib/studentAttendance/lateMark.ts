// Late Marking: a faculty member posts student attendance for one of their own periods AFTER its posting window
// closed (the college end time + extra minutes, or midnight for offline marking), for up to N days back
// (colleges/{c}/settings/attendancePosting.lateMarkDays, default 3, 0 = off), with a reason. It counts at once (no
// approval); the session carries `lateMark` and the HOD of the CLASS's (section's) department is told. Pure rules
// here; the server checks are lib/studentAttendance/lateMarkServer.ts.

export const DEFAULT_LATE_MARK_DAYS = 3;
export const MAX_LATE_MARK_DAYS = 7;
export const MAX_LATE_REASON = 500;

export function cleanLateMarkDays(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_LATE_MARK_DAYS ? n : null;
}

/** The request's `lateMark: { reason }`, or null when absent. Throws a readable message on a blank reason. */
export function parseLateMark(raw: unknown): { reason: string } | null {
  if (raw == null || raw === false) return null;
  const reason = typeof (raw as { reason?: unknown })?.reason === "string" ? (raw as { reason: string }).reason.trim() : "";
  if (!reason) throw new Error("Enter the reason for marking this class late.");
  return { reason: reason.slice(0, MAX_LATE_REASON) };
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Whole days from `date` to `today` (0 = today). */
export function daysBetween(date: string, today: string): number {
  return dayNumber(today) - dayNumber(date);
}

/** The dates Late Marking may reach, newest first: today and the `days` before it. */
export function lateMarkDates(today: string, days: number): string[] {
  const out: string[] = [];
  const [y, m, d] = today.split("-").map(Number);
  for (let i = 0; i <= days; i++) {
    const t = new Date(Date.UTC(y, m - 1, d - i));
    out.push(t.toISOString().slice(0, 10));
  }
  return out;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** A permission (pending or approved) that covers the whole period: the faculty member was away for it. */
export function permissionCoversPeriod(p: { fromTime: string; toTime: string }, period: { startTime: string; endTime: string }): boolean {
  return toMin(p.fromTime) <= toMin(period.startTime) && toMin(p.toTime) >= toMin(period.endTime);
}

/** Why a missed period can't be late-marked (null = it can). Order = the first reason shown. */
export function lateMarkBlock(ctx: {
  date: string;
  today: string;
  nowMinutes: number;
  days: number;
  closeTime: string;
  onLeave: boolean;
  permissionCovers: boolean;
}): string | null {
  if (ctx.days <= 0) return "Late marking is turned off for this college.";
  const back = daysBetween(ctx.date, ctx.today);
  if (back < 0) return "This class has not happened yet.";
  if (back > ctx.days) return `Late marking is allowed only up to ${ctx.days} day${ctx.days === 1 ? "" : "s"} back. Ask your HOD to correct it.`;
  if (back === 0 && ctx.nowMinutes < toMin(ctx.closeTime)) return "Posting for this class is still open - mark it the usual way.";
  if (ctx.onLeave) return "You were on approved leave for this class.";
  if (ctx.permissionCovers) return "You had a permission for the whole of this class, so it was not yours to take.";
  return null;
}

export const lateMarkTypeLabel = "Marked Late";
