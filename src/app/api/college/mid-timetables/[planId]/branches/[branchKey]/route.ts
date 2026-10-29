export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, guardError } from "@/lib/midBank/server";
import { branchKey } from "@/lib/midBank/sections";
import { checkSlots, DEFAULT_MAX_PER_DAY, usualSessionOf } from "@/lib/midTimetable/rules";
import { branchSubjects, loadPlan, MID_TIMETABLE_EDITORS, midTimetableRefs } from "@/lib/midTimetable/server";
import type { MidTimetable } from "@/types";

// Exam Cell: save one branch's Mid timetable. action "draft" saves what is
// placed (clashes refused); "publish" also needs every subject placed and shows
// it to the branch's students, its faculty, the HOD and the Principal / VP;
// "unpublish" takes it back to a draft. A stale `baseRev` is refused (409).

type Params = { params: Promise<{ planId: string; branchKey: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_TIMETABLE_EDITORS);
    const { planId, branchKey: key } = await params;
    const body = (await readJsonBody(request)) as { action?: string; slots?: unknown; baseRev?: number };
    const action = body.action === "publish" || body.action === "unpublish" ? body.action : "draft";
    const db = getAdminDb();
    const refs = midTimetableRefs(db, session.collegeId);
    const plan = await loadPlan(db, session.collegeId, planId);
    if (!plan) return NextResponse.json({ error: "Timetable not found" }, { status: 404 });
    const all = await branchSubjects(db, session.collegeId, plan);
    const branch = [...all.keys()].find((b) => branchKey(b) === key);
    if (!branch) return NextResponse.json({ error: "This branch has no Theory subjects taught in this semester" }, { status: 404 });
    const subjects = all.get(branch)!;

    const checked = checkSlots(body.slots, subjects, plan.days, plan.sessions, plan.maxPerDay ?? DEFAULT_MAX_PER_DAY);
    if (action !== "unpublish") {
      if (checked.errors.length) return NextResponse.json({ error: checked.errors[0], errors: checked.errors }, { status: 400 });
      if (action === "publish" && !checked.complete) {
        const missing = subjects.filter((s) => !checked.slots.some((x) => x.subjectId === s.subjectId)).map((s) => s.subjectName);
        return NextResponse.json({ error: `Place every subject before publishing - not placed: ${missing.join(", ")}` }, { status: 400 });
      }
    }

    const name = await actorName(db, session.collegeId, session.uid);
    const id = `${planId}__${key}`;
    const result = await db.runTransaction(async (tx) => {
      const ref = refs.timetables.doc(id);
      const snap = await tx.get(ref);
      const cur = snap.exists ? (snap.data() as MidTimetable) : null;
      if (Number(body.baseRev ?? 0) !== (cur?.rev ?? 0)) return { status: 409, body: { error: "This timetable was changed in another tab or by someone else - reload it" } };
      const now = new Date();
      const used = new Set(checked.slots.map((s) => s.sessionId));
      const usual = usualSessionOf(plan.sessions, plan.branchSessions?.[key], action === "unpublish" ? cur?.slots ?? [] : checked.slots);
      const data: Omit<MidTimetable, "id"> = {
        planId, courseName: plan.courseName, courseIds: plan.courseIds, year: plan.year, semester: plan.semester, midNumber: plan.midNumber, branch,
        slots: action === "unpublish" ? (cur?.slots ?? []) : checked.slots,
        sessions: plan.sessions.filter((s) => action === "publish" ? used.has(s.id) || s.id === usual : true),
        status: action === "publish" ? "PUBLISHED" : "DRAFT",
        rev: (cur?.rev ?? 0) + 1,
        usualSessionId: usual,
        publishedAt: action === "publish" ? (now as unknown as MidTimetable["publishedAt"]) : null,
        publishedByName: action === "publish" ? name : "",
        updatedBy: session.uid, updatedByName: name, updatedAt: now as unknown as MidTimetable["updatedAt"],
      };
      tx.set(ref, data);
      return { status: 200, body: { timetable: { id, ...data } } };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-timetables/[planId]/branches/[branchKey] PUT]");
  }
}
