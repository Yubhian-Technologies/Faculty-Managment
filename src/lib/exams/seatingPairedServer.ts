import type { Firestore } from "firebase-admin/firestore";
import { branchKey } from "@/lib/midBank/sections";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { timeLabel } from "@/lib/midTimetable/rules";
import { loadSectionStudents } from "@/lib/exams/seatingStudents";
import { sortByRoll } from "@/lib/exams/seatingAllocator";
import { sectionLabel } from "@/lib/exams/seatingSections";
import type { MidTimetable, Section } from "@/types";
import type { SeatingStudent } from "@/types/examSeating";

// Paired seating, server side: which exams the Mid timetables put on a date
// and time, and the students of each (branch + year) group - section by
// section (A, then B ...), each section in Regd. No order.

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

async function timetables(db: Firestore, collegeId: string): Promise<MidTimetable[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("midTimetables").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidTimetable, "id">) }));
}

/** Every date + exam time the Mid timetables hold, with how many groups write then. */
export async function examSittings(db: Firestore, collegeId: string) {
  const days = new Map<string, Map<string, { time: string; label: string; groups: Set<string> }>>();
  for (const t of await timetables(db, collegeId)) {
    for (const sl of t.slots) {
      const ses = t.sessions.find((x) => x.id === sl.sessionId);
      if (!ses) continue;
      const k = timeKey(ses.from, ses.to);
      const m = days.get(sl.date) ?? new Map();
      const e = m.get(k) ?? { time: k, label: `${timeLabel(ses.from)} - ${timeLabel(ses.to)}`, groups: new Set<string>() };
      e.groups.add(`${t.planId}|${branchKey(t.branch)}`);
      m.set(k, e);
      days.set(sl.date, m);
    }
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, m]) => ({
    date, times: [...m.values()].sort((a, b) => a.time.localeCompare(b.time)).map((e) => ({ time: e.time, label: e.label, groups: e.groups.size })),
  }));
}

/** The groups writing on `date` at `time`, with their sections (sorted A, B ...). */
export async function sittingGroups(db: Firestore, collegeId: string, date: string, time: string): Promise<SittingGroup[]> {
  const [tts, secSnap] = await Promise.all([timetables(db, collegeId), db.collection("colleges").doc(collegeId).collection("sections").get()]);
  const sections = secSnap.docs.map((d) => ({ ...(d.data() as Section), id: d.id }));
  const out: SittingGroup[] = [];
  for (const t of tts) {
    const subjects = t.slots.filter((sl) => {
      const ses = t.sessions.find((x) => x.id === sl.sessionId);
      return sl.date === date && ses && timeKey(ses.from, ses.to) === time;
    }).map((sl) => sl.subjectName);
    if (subjects.length === 0) continue;
    out.push({
      key: `${t.planId}|${branchKey(t.branch)}`,
      label: `${t.branch} (${ordinalYearLabel(t.year)})`,
      courseName: t.courseName, year: t.year, branch: t.branch, subjects,
      sections: sections.filter((s) => t.courseIds.includes(s.courseId) && Number(s.year) === t.year && s.department === t.branch)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** A group's students: section by section, each section in Regd. No order, tagged with the group. */
export async function groupStudents(db: Firestore, collegeId: string, g: SittingGroup): Promise<SeatingStudent[]> {
  const lists = await Promise.all(g.sections.map((s) => loadSectionStudents(db, collegeId, s)));
  return lists.flatMap((l, i) => sortByRoll(l).map((st) => ({ ...st, sectionLabel: sectionLabel(g.sections[i]), group: g.label })));
}
