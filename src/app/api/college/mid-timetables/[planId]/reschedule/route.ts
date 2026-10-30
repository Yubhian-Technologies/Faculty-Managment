export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { batchNotify } from "@/lib/notify";
import { actorName, guardError, loginUidsOf } from "@/lib/midBank/server";
import { branchKey } from "@/lib/midBank/sections";
import { dayLabel, MAX_DAYS, MAX_SPAN_DAYS, rescheduleSlots } from "@/lib/midTimetable/rules";
import { loadPlan, MID_TIMETABLE_EDITORS, midTimetableRefs } from "@/lib/midTimetable/server";
import { teachingFor } from "@/lib/midBank/server";
import type { MidTimetable, MidTimetableChange, StudentRecord } from "@/types";

// Exam Cell: postpone / prepone a Mid exam day - for one branch or the whole
// year (every branch of the plan). Every exam of that day + session moves to the
// new day + session; a published timetable stays published with the new date.
// Refused (nothing written) when the new slot already has an exam of an affected
// branch. Each moved exam remembers its first date; each timetable keeps the
// change in `changes`. The faculty and students of the affected branches are told.

type Params = { params: Promise<{ planId: string }> };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_TIMETABLE_EDITORS);
    const { planId } = await params;
    const body = (await readJsonBody(request)) as { scope?: string; fromDate?: string; fromSessionId?: string; toDate?: string; toSessionId?: string; reason?: string; dryRun?: boolean };
    const fromDate = String(body.fromDate ?? ""), toDate = String(body.toDate ?? "");
    const reason = String(body.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!DATE.test(fromDate) || !DATE.test(toDate) || Number.isNaN(Date.parse(toDate))) return NextResponse.json({ error: "Pick the exam day to move and the new date" }, { status: 400 });

    const db = getAdminDb();
    const refs = midTimetableRefs(db, session.collegeId);
    const plan = await loadPlan(db, session.collegeId, planId);
    if (!plan) return NextResponse.json({ error: "Timetable not found" }, { status: 404 });
    const fromSessionId = String(body.fromSessionId || plan.sessions[0]?.id || "");
    const toSessionId = String(body.toSessionId || fromSessionId);
    if (!plan.sessions.some((s) => s.id === fromSessionId) || !plan.sessions.some((s) => s.id === toSessionId)) return NextResponse.json({ error: "Pick a session" }, { status: 400 });
    if (fromDate === toDate && fromSessionId === toSessionId) return NextResponse.json({ error: "The new date is the same as the old one" }, { status: 400 });
    if (new Date(`${toDate}T00:00:00Z`).getUTCDay() === 0) return NextResponse.json({ error: `${dayLabel(toDate)} is a Sunday` }, { status: 400 });
    const scope = String(body.scope ?? "ALL");

    const name = await actorName(db, session.collegeId, session.uid);
    const result = await db.runTransaction(async (tx) => {
      const snaps = (await tx.get(refs.timetables.where("planId", "==", planId))).docs;
      const inScope = snaps.filter((d) => scope === "ALL" || d.id === `${planId}__${scope}`);
      if (scope !== "ALL" && inScope.length === 0) return { status: 404, body: { error: "That branch has no saved timetable yet" } };

      const moves: { ref: FirebaseFirestore.DocumentReference; t: MidTimetable; slots: MidTimetable["slots"]; moved: string[] }[] = [];
      const clashes: string[] = [];
      for (const d of inScope) {
        const t = { id: d.id, ...(d.data() as Omit<MidTimetable, "id">) };
        const r = rescheduleSlots(t.slots, { date: fromDate, sessionId: fromSessionId }, { date: toDate, sessionId: toSessionId });
        if (r.clash.length) clashes.push(`${t.branch} already has ${r.clash.join(" / ")} then`);
        else if (r.moved.length) moves.push({ ref: d.ref, t, slots: r.slots, moved: r.moved.map((m) => m.subjectName) });
      }
      if (clashes.length) return { status: 409, body: { error: `Not moved - ${clashes.join("; ")}`, clashes } };
      if (moves.length === 0) return { status: 400, body: { error: `No exam ${scope === "ALL" ? "of this year" : "of this branch"} is on ${dayLabel(fromDate)}` } };
      const preview = moves.map((m) => ({ branch: m.t.branch, subjects: m.moved, status: m.t.status }));
      if (body.dryRun) return { status: 200, body: { preview } };

      // The new day joins the plan; the old one leaves it when no timetable uses it any more.
      const stillUsed = snaps.some((d) => {
        const mv = moves.find((m) => m.ref.id === d.id);
        return (mv ? mv.slots : (d.data() as MidTimetable).slots).some((s) => s.date === fromDate);
      });
      const days = [...new Set([...plan.days.filter((x) => x !== fromDate || stillUsed), toDate])].sort();
      if (days.length > MAX_DAYS || (Date.parse(days[days.length - 1]) - Date.parse(days[0])) / 86_400_000 > MAX_SPAN_DAYS) {
        return { status: 400, body: { error: "The exam days would span more than three months" } };
      }
      const now = new Date();
      for (const m of moves) {
        const change: MidTimetableChange = { at: now.toISOString(), byName: name, fromDate, fromSessionId, toDate, toSessionId, subjects: m.moved, reason, scope: scope === "ALL" ? "ALL" : "BRANCH" };
        tx.update(m.ref, { slots: m.slots, changes: [...(m.t.changes ?? []), change], rev: (m.t.rev ?? 0) + 1, updatedBy: session.uid, updatedByName: name, updatedAt: now });
      }
      tx.update(refs.plans.doc(planId), { days, updatedBy: session.uid, updatedByName: name, updatedAt: now });
      return { status: 200, body: { preview, days } };
    });
    if (result.status !== 200 || body.dryRun) return NextResponse.json(result.body, { status: result.status });

    // Tell the faculty and students of the affected PUBLISHED branches (they never saw a draft).
    const told = await notifyAffected(db, session.collegeId, plan, (result.body.preview as { branch: string; status: string }[]).filter((p) => p.status === "PUBLISHED").map((p) => p.branch),
      `Mid ${plan.midNumber} exam ${toDate > fromDate ? "postponed" : "preponed"}`,
      `${dayLabel(fromDate)} exam moved to ${dayLabel(toDate)}${reason ? ` - ${reason}` : ""}.`);
    return NextResponse.json({ ...result.body, notified: told });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-timetables/[planId]/reschedule POST]");
  }
}

async function notifyAffected(db: FirebaseFirestore.Firestore, collegeId: string, plan: { courseIds: string[]; courseName: string; year: number; semester: number }, branches: string[], title: string, message: string): Promise<number> {
  if (branches.length === 0) return 0;
  const set = new Set(branches);
  const keys = new Set(branches.map(branchKey));
  const rows = (await teachingFor(db, collegeId, plan)).filter((r) => set.has(r.branch));
  const facultyUids = [...(await loginUidsOf(db, collegeId, [...new Set(rows.map((r) => r.facultyId))])).values()];
  const students = (await db.collection("colleges").doc(collegeId).collection("students").where("year", "==", plan.year).get()).docs
    .map((d) => d.data() as StudentRecord & { uid?: string })
    // Same programme only: by courseId when the record has one, else by course name (none on record = kept).
    .filter((s) => (s.courseId ? plan.courseIds.includes(s.courseId) : !s.course || s.course.trim().toLowerCase() === plan.courseName.trim().toLowerCase()))
    .filter((s) => typeof s.uid === "string" && s.uid && (s.status === "REGULAR" || s.status === "DETAINED")
      && (keys.has(branchKey(s.department ?? "")) || (s.secondaryDepartment && keys.has(branchKey(s.secondaryDepartment)))))
    .map((s) => s.uid as string);
  await batchNotify(db, collegeId, facultyUids, "MID_TIMETABLE_CHANGED", title, message, "/panel/mid-timetable");
  await batchNotify(db, collegeId, students, "MID_TIMETABLE_CHANGED", title, message, "/student/mid-timetable");
  return facultyUids.length + new Set(students).size;
}
