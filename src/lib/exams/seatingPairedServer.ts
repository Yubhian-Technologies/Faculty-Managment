import type { Firestore } from "firebase-admin/firestore";
import { branchKey } from "@/lib/midBank/sections";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { loadSectionStudents } from "@/lib/exams/seatingStudents";
import { sortByRoll } from "@/lib/exams/seatingAllocator";
import { sectionLabel } from "@/lib/exams/seatingSections";
import type { MidExamPlan, MidTimetable, Section } from "@/types";
import { timeLabel, usualSessionOf } from "@/lib/midTimetable/rules";
import type { SeatingStudent } from "@/types/examSeating";

// Paired seating, server side: the Mid timetables to seat (one arrangement for
// every exam day of the Mid), the (branch + year) groups in them, and each
// group's students - section by section (A, then B ...), each in Regd. No order.

export interface SittingGroup {
  key: string; // `${planId}|${branchKey}`
  label: string; // "Computer Science and Engineering (2nd Year)"
  courseName: string;
  year: number;
  branch: string;
  subjects: string[];
  sections: Section[];
}

const timeKey = (from: string, to: string) => `${from}-${to}`;

/** A timetable's usual session as a time key ("10:00-11:30") - branches seated together write at the same time. */
function usualTime(t: MidTimetable, plan?: MidExamPlan): string {
  const sessions = plan?.sessions?.length ? plan.sessions : t.sessions;
  const id = t.usualSessionId ?? usualSessionOf(sessions, plan?.branchSessions?.[branchKey(t.branch)], t.slots);
  const s = sessions.find((x) => x.id === id) ?? t.sessions.find((x) => x.id === id);
  return s ? timeKey(s.from, s.to) : "";
}

async function timetables(db: Firestore, collegeId: string): Promise<MidTimetable[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("midTimetables").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidTimetable, "id">) }));
}

/** The Mid timetables that have branches saved - each one Mid of one course + year + semester. */
export async function midSources(db: Firestore, collegeId: string) {
  const [plans, tts] = await Promise.all([
    db.collection("colleges").doc(collegeId).collection("midExamPlans").get(),
    timetables(db, collegeId),
  ]);
  return plans.docs.map((d) => {
    const p = d.data() as MidExamPlan;
    const mine = tts.filter((t) => t.planId === d.id);
    const days = [...new Set(mine.flatMap((t) => t.slots.map((s) => s.date)))].sort();
    // The sessions branches usually write in - one seating arrangement each.
    const times = new Map<string, { time: string; label: string; branches: number }>();
    for (const t of mine) {
      const k = usualTime(t, p);
      const ses = p.sessions.find((x) => timeKey(x.from, x.to) === k);
      const e = times.get(k) ?? { time: k, label: ses ? `${ses.label} · ${timeLabel(ses.from)} - ${timeLabel(ses.to)}` : k, branches: 0 };
      e.branches++;
      times.set(k, e);
    }
    return {
      id: d.id, label: `${p.courseName} · ${ordinalYearLabel(p.year)} · Sem ${p.semester} · Mid ${p.midNumber}`, midNumber: p.midNumber,
      branches: mine.length, days, sessions: [...times.values()].sort((a, b) => a.time.localeCompare(b.time)),
      time: p.sessions.length === 1 ? timeKey(p.sessions[0].from, p.sessions[0].to) : "",
    };
  }).filter((x) => x.branches > 0).sort((a, b) => (b.days[0] ?? "").localeCompare(a.days[0] ?? "") || a.label.localeCompare(b.label));
}

/** The groups (branch + year) of the Mid timetables picked, with their sections (sorted A, B ...). */
export async function midGroups(db: Firestore, collegeId: string, planIds: string[], time?: string): Promise<SittingGroup[]> {
  const college = db.collection("colleges").doc(collegeId);
  const [tts, secSnap, planSnaps] = await Promise.all([
    timetables(db, collegeId), college.collection("sections").get(),
    planIds.length ? db.getAll(...planIds.map((id) => college.collection("midExamPlans").doc(id))) : [],
  ]);
  const plans = new Map(planSnaps.filter((p) => p.exists).map((p) => [p.id, p.data() as MidExamPlan]));
  const sections = secSnap.docs.map((d) => ({ ...(d.data() as Section), id: d.id }));
  // Only the branches that usually write at `time` when a session is picked.
  return tts.filter((t) => planIds.includes(t.planId) && (!time || usualTime(t, plans.get(t.planId)) === time)).map((t) => ({
    key: `${t.planId}|${branchKey(t.branch)}`,
    label: `${t.branch} (${ordinalYearLabel(t.year)})`,
    courseName: t.courseName, year: t.year, branch: t.branch,
    subjects: t.slots.map((sl) => sl.subjectName),
    sections: sections.filter((s) => t.courseIds.includes(s.courseId) && Number(s.year) === t.year && s.department === t.branch)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  })).sort((a, b) => a.label.localeCompare(b.label));
}

/** A group's students: section by section, each section in Regd. No order, tagged with the group. */
export async function groupStudents(db: Firestore, collegeId: string, g: SittingGroup): Promise<SeatingStudent[]> {
  const lists = await Promise.all(g.sections.map((s) => loadSectionStudents(db, collegeId, s)));
  return lists.flatMap((l, i) => sortByRoll(l).map((st) => ({ ...st, sectionLabel: sectionLabel(g.sections[i]), group: g.label })));
}
