import { istDateKey } from "@/lib/attendance/istTime";

// The question bank deadline: the last day banks may be written. A bank is
// locked from the next day (IST) until the Exam Cell extends the deadline.

export const isDeadlineLocked = (deadline: string, today: string = istDateKey()) => !deadline || today > deadline;

/** "Due 20 Nov 2026" / "Locked since 21 Nov 2026" - for badges. */
export function deadlineLabel(deadline: string, today: string = istDateKey()): string {
  const d = new Date(`${deadline}T00:00:00Z`);
  const text = Number.isNaN(d.getTime()) ? deadline : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return isDeadlineLocked(deadline, today) ? `Deadline ${text} passed` : `Due ${text}`;
}

/** Whole days from today (IST) to the deadline day; negative once it has passed, null for a bad date. */
export function daysLeft(deadline: string, today: string = istDateKey()): number | null {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${deadline}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86_400_000);
}

/** A deadline must be a real date, not in the past, and before the Mid's exam starts (when its dates are set). */
export function deadlineError(deadline: string, today: string, midStarts: string | null): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(Date.parse(deadline))) return "Pick the deadline date";
  if (deadline < today) return "The deadline can't be in the past";
  if (midStarts && deadline >= midStarts) return `The deadline must be before the Mid starts (${midStarts})`;
  return "";
}
