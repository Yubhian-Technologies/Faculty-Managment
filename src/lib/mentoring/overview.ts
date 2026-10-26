import { MEETING_CATEGORIES } from "./recordSections";
import type { MentoringOverview, MentoringOverviewRow } from "@/types/mentoring";

// The college-wide mentoring summary for the Principal and Vice-Principal. Pure: it counts rows
// and categories and never carries a note's text, so a senior role sees how mentoring is going
// without reading a student's confidential record. The route feeds it only the few fields below.

export const OVERVIEW_RECENT_DAYS = 30;
const WEEKLY_WINDOW_DAYS = 28;

export interface OverviewStudent {
  id: string;
  department: string;
  mentorUid?: string;
  mentorName?: string;
  status?: string;
}

export interface OverviewEntry {
  studentId: string;
  section: string;
  categories?: string[];
  /** actionItems / escalations / weeklyAttendance: the row's status. */
  status?: string;
  /** meetings: date of the meeting. */
  date?: string;
  dueDate?: string;
  weekStart?: string;
}

const DAY_MS = 86_400_000;
const dayNumber = (key: string): number => Math.floor(new Date(`${key}T00:00:00Z`).getTime() / DAY_MS);
const isDateKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(dayNumber(v));

/** `today` is an IST date key ("YYYY-MM-DD"). Students who graduated or left are not counted. */
export function buildMentoringOverview(students: OverviewStudent[], entries: OverviewEntry[], today: string): MentoringOverview {
  const live = students.filter((s) => s.status !== "GRADUATED" && s.status !== "DISCONTINUED");
  const liveIds = new Set(live.map((s) => s.id));
  const todayN = dayNumber(today);

  const met = new Set<string>(); // a meeting inside the recent window
  const everMet = new Set<string>();
  const openActionsBy = new Map<string, number>();
  const openEscalationsBy = new Map<string, number>();
  const categories = new Map<string, number>(MEETING_CATEGORIES.map((c) => [c.value, 0]));
  const actions = { open: 0, inProgress: 0, done: 0, overdue: 0 };
  const escalations = { open: 0, underReview: 0, resolved: 0 };
  const weekly = { present: 0, absent: 0, excused: 0 };
  let meetings = 0;

  for (const e of entries) {
    if (!liveIds.has(e.studentId)) continue;
    if (e.section === "meetings") {
      meetings++;
      everMet.add(e.studentId);
      if (isDateKey(e.date) && todayN - dayNumber(e.date) <= OVERVIEW_RECENT_DAYS) met.add(e.studentId);
      for (const c of e.categories ?? []) if (categories.has(c)) categories.set(c, (categories.get(c) ?? 0) + 1);
    } else if (e.section === "actionItems") {
      if (e.status === "Done") {
        actions.done++;
      } else {
        if (e.status === "In progress") actions.inProgress++;
        else actions.open++;
        openActionsBy.set(e.studentId, (openActionsBy.get(e.studentId) ?? 0) + 1);
        if (isDateKey(e.dueDate) && dayNumber(e.dueDate) < todayN) actions.overdue++;
      }
    } else if (e.section === "escalations") {
      if (e.status === "Resolved") {
        escalations.resolved++;
      } else {
        if (e.status === "Under review") escalations.underReview++;
        else escalations.open++;
        openEscalationsBy.set(e.studentId, (openEscalationsBy.get(e.studentId) ?? 0) + 1);
      }
    } else if (e.section === "weeklyAttendance") {
      if (!isDateKey(e.weekStart) || todayN - dayNumber(e.weekStart) > WEEKLY_WINDOW_DAYS) continue;
      if (e.status === "Present") weekly.present++;
      else if (e.status === "Absent") weekly.absent++;
      else if (e.status === "Excused") weekly.excused++;
    }
  }

  const rollup = (keyOf: (s: (typeof live)[number]) => { key: string; label: string } | null): MentoringOverviewRow[] => {
    const rows = new Map<string, MentoringOverviewRow>();
    for (const s of live) {
      const k = keyOf(s);
      if (!k) continue;
      const row = rows.get(k.key) ?? { key: k.key, label: k.label, students: 0, mentored: 0, metRecently: 0, openActions: 0, openEscalations: 0 };
      row.students++;
      if (s.mentorUid) row.mentored++;
      if (s.mentorUid && met.has(s.id)) row.metRecently++;
      row.openActions += openActionsBy.get(s.id) ?? 0;
      row.openEscalations += openEscalationsBy.get(s.id) ?? 0;
      rows.set(k.key, row);
    }
    return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
  };

  const mentored = live.filter((s) => s.mentorUid);
  return {
    recentDays: OVERVIEW_RECENT_DAYS,
    totals: {
      students: live.length,
      mentored: mentored.length,
      unmentored: live.length - mentored.length,
      metRecently: mentored.filter((s) => met.has(s.id)).length,
      neverMet: mentored.filter((s) => !everMet.has(s.id)).length,
      meetings,
    },
    categories: MEETING_CATEGORIES.map((c) => ({ value: c.value, label: c.label, meetings: categories.get(c.value) ?? 0 })),
    actions,
    escalations,
    weekly,
    // Department rows cover every student (unmentored ones just show no mentor); mentor rows only mentored ones.
    byDepartment: rollup((s) => ({ key: s.department || "-", label: s.department || "No department" })),
    byMentor: rollup((s) => (s.mentorUid ? { key: s.mentorUid, label: s.mentorName || "Mentor" } : null)),
  };
}
