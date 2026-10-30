export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { istDateKey } from "@/lib/attendance/istTime";
import { deadlineError, isDeadlineLocked } from "@/lib/midBank/deadline";
import { actorName, courseIdsForKey, guardError, MID_BANK_READ_ROLES, midBankRefs } from "@/lib/midBank/server";
import { midStartDate, notifyTeachers } from "@/lib/midBank/deadlineServer";
import type { MidBankDeadline } from "@/types";

// Question bank deadlines (Exam Cell, set before the Mid timings): one per
// Course + Year + Semester + Mid. Publishing one opens the Question Bank module
// for every faculty member teaching a subject of that semester and notifies them.

export async function GET() {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const snap = await midBankRefs(getAdminDb(), session.collegeId).deadlines.get();
    const today = istDateKey();
    const deadlines = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<MidBankDeadline, "id">) }))
      .map((d) => ({ ...d, locked: isDeadlineLocked(d.deadline, today) }))
      .sort((a, b) => b.deadline.localeCompare(a.deadline) || a.courseName.localeCompare(b.courseName));
    return NextResponse.json({ deadlines });
  } catch (err) {
    return guardError(err, "[college/mid-bank-deadlines GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { courseKey?: string; year?: number; semester?: number; midNumber?: number; deadline?: string };
    const courseKey = String(body.courseKey ?? "").trim();
    const year = Number(body.year), semester = Number(body.semester), midNumber = Number(body.midNumber);
    const deadline = String(body.deadline ?? "").trim();
    const db = getAdminDb();
    const refs = midBankRefs(db, session.collegeId);

    const course = courseKey ? await courseIdsForKey(db, session.collegeId, courseKey) : null;
    if (!course || course.ids.length === 0) return NextResponse.json({ error: "Pick a course" }, { status: 400 });
    if (!Number.isInteger(year) || year < 1 || year > (course.durationYears || 10)) return NextResponse.json({ error: "Pick the year" }, { status: 400 });
    if (!Number.isInteger(semester) || semester < 1) return NextResponse.json({ error: "Pick the semester" }, { status: 400 });
    const midCount = Number((await refs.college.collection("examSettings").doc("mid").get()).get("midCount")) || 2;
    if (!Number.isInteger(midNumber) || midNumber < 1 || midNumber > midCount) return NextResponse.json({ error: `Pick a Mid from 1 to ${midCount}` }, { status: 400 });
    const err = deadlineError(deadline, istDateKey(), await midStartDate(db, session.collegeId, course.ids, course.name, semester, midNumber));
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const id = `${courseKey}__y${year}__s${semester}__m${midNumber}`.replace(/[/\s]+/g, "-");
    const name = await actorName(db, session.collegeId, session.uid);
    const now = new Date();
    const data = {
      courseKey, courseName: course.name, courseIds: course.ids, year, semester, midNumber, deadline, extensions: [],
      createdBy: session.uid, createdByName: name, createdAt: now, updatedAt: now,
    };
    const created = await db.runTransaction(async (tx) => {
      const ref = refs.deadlines.doc(id);
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, data);
      return true;
    });
    if (!created) return NextResponse.json({ error: "A deadline is already set for this course, year, semester and Mid - change it instead" }, { status: 409 });

    const deadlineDoc = { id, ...data } as unknown as MidBankDeadline;
    const notified = await notifyTeachers(db, session.collegeId, deadlineDoc, `Mid ${midNumber} question bank is open`);
    return NextResponse.json({ deadline: deadlineDoc, notified }, { status: 201 });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-bank-deadlines POST]");
  }
}
