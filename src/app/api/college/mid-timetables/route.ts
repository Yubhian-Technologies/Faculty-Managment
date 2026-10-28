export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, courseIdsForKey, guardError } from "@/lib/midBank/server";
import { examDaysBetween } from "@/lib/midTimetable/rules";
import { MID_TIMETABLE_EDITORS, midTimetableRefs, midWindow, planIdFor } from "@/lib/midTimetable/server";
import type { MidExamPlan, MidTimetable } from "@/types";

// Exam Cell: the Mid exam timetable plans (one per course + year + semester +
// Mid) with how many branch timetables are published; POST starts a plan.

export async function GET() {
  try {
    const session = await requireCollegeMember(...MID_TIMETABLE_EDITORS);
    const refs = midTimetableRefs(getAdminDb(), session.collegeId);
    const [plans, tts] = await Promise.all([refs.plans.get(), refs.timetables.get()]);
    const byPlan = new Map<string, { branch: string; status: MidTimetable["status"] }[]>();
    for (const d of tts.docs) {
      const t = d.data() as MidTimetable;
      byPlan.set(t.planId, [...(byPlan.get(t.planId) ?? []), { branch: t.branch, status: t.status }]);
    }
    const list = plans.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<MidExamPlan, "id">) }))
      .map((p) => ({ ...p, timetables: byPlan.get(p.id) ?? [] }))
      .sort((a, b) => (a.days[0] ?? "").localeCompare(b.days[0] ?? "") * -1 || a.courseName.localeCompare(b.courseName) || a.year - b.year || a.midNumber - b.midNumber);
    return NextResponse.json({ plans: list });
  } catch (err) {
    return guardError(err, "[college/mid-timetables GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_TIMETABLE_EDITORS);
    const body = (await readJsonBody(request)) as { courseKey?: string; year?: number; semester?: number; midNumber?: number };
    const courseKey = String(body.courseKey ?? "").trim();
    const year = Number(body.year), semester = Number(body.semester), midNumber = Number(body.midNumber);
    const db = getAdminDb();
    const refs = midTimetableRefs(db, session.collegeId);

    const course = courseKey ? await courseIdsForKey(db, session.collegeId, courseKey) : null;
    if (!course || course.ids.length === 0) return NextResponse.json({ error: "Pick a course" }, { status: 400 });
    if (!Number.isInteger(year) || year < 1 || year > (course.durationYears || 10)) return NextResponse.json({ error: "Pick the year" }, { status: 400 });
    if (!Number.isInteger(semester) || semester < 1) return NextResponse.json({ error: "Pick the semester" }, { status: 400 });
    const midCount = Number((await refs.college.collection("examSettings").doc("mid").get()).get("midCount")) || 2;
    if (!Number.isInteger(midNumber) || midNumber < 1 || midNumber > midCount) return NextResponse.json({ error: `Pick a Mid from 1 to ${midCount}` }, { status: 400 });

    // The Mid's dates must be published first: they decide the exam days.
    const window = await midWindow(db, session.collegeId, { courseIds: course.ids, courseName: course.name, semester, midNumber });
    if (!window) return NextResponse.json({ error: `Publish the Mid ${midNumber} dates for ${course.name} semester ${semester} on Mid Timings & Dates first` }, { status: 400 });

    const id = planIdFor(courseKey, year, semester, midNumber);
    const name = await actorName(db, session.collegeId, session.uid);
    const now = new Date();
    const data = {
      courseKey, courseName: course.name, courseIds: course.ids, year, semester, midNumber,
      days: examDaysBetween(window.from, window.to),
      sessions: [{ id: "S1", label: "Session 1", from: window.fromTime || "10:00", to: window.toTime || "11:30" }],
      createdBy: session.uid, createdByName: name, updatedBy: session.uid, updatedByName: name, createdAt: now, updatedAt: now,
    };
    const created = await db.runTransaction(async (tx) => {
      const ref = refs.plans.doc(id);
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, data);
      return true;
    });
    if (!created) return NextResponse.json({ error: "This Mid already has a timetable - open it from the list", id }, { status: 409 });
    return NextResponse.json({ plan: { id, ...data } }, { status: 201 });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-timetables POST]");
  }
}
