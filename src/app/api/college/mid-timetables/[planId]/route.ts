export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, guardError } from "@/lib/midBank/server";
import { branchKey } from "@/lib/midBank/sections";
import { cleanDays, cleanSessions, DEFAULT_MAX_PER_DAY, MAX_SESSIONS } from "@/lib/midTimetable/rules";
import { branchSubjects, examOfPlan, loadPlan, MID_TIMETABLE_EDITORS, midTimetableRefs, midWindow } from "@/lib/midTimetable/server";
import type { MidTimetable } from "@/types";

// Exam Cell: one Mid's timetable plan - its exam days and sessions, and every
// branch with its Theory subjects and timetable (draft or published).
// PATCH changes the days / sessions; DELETE removes a plan nothing is published for.

type Params = { params: Promise<{ planId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_TIMETABLE_EDITORS);
    const { planId } = await params;
    const db = getAdminDb();
    const plan = await loadPlan(db, session.collegeId, planId);
    if (!plan) return NextResponse.json({ error: "Timetable not found" }, { status: 404 });
    const [window, subjects, tts, exam] = await Promise.all([
      midWindow(db, session.collegeId, plan),
      branchSubjects(db, session.collegeId, plan),
      midTimetableRefs(db, session.collegeId).timetables.where("planId", "==", planId).get(),
      examOfPlan(db, session.collegeId, plan),
    ]);
    const saved = new Map(tts.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<MidTimetable, "id">) }]));
    const branches = [...subjects.entries()].map(([branch, list]) => {
      const key = branchKey(branch);
      return { branch, key, subjects: list, timetable: saved.get(`${planId}__${key}`) ?? null };
    });
    // The range days are picked from: the Mid's published dates, else the plan's own.
    const range = window ? { from: window.from, to: window.to } : plan.from && plan.to ? { from: plan.from, to: plan.to } : null;
    return NextResponse.json({ plan, window, range, branches, exam });
  } catch (err) {
    return guardError(err, "[college/mid-timetables/[planId] GET]");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_TIMETABLE_EDITORS);
    const { planId } = await params;
    const body = (await readJsonBody(request)) as { days?: unknown; sessions?: unknown; branchSessions?: unknown; maxPerDay?: unknown };
    const db = getAdminDb();
    const refs = midTimetableRefs(db, session.collegeId);
    const plan = await loadPlan(db, session.collegeId, planId);
    if (!plan) return NextResponse.json({ error: "Timetable not found" }, { status: 404 });
    const d = cleanDays(body.days);
    if (d.error) return NextResponse.json({ error: d.error }, { status: 400 });
    const s = cleanSessions(body.sessions);
    if (s.error) return NextResponse.json({ error: s.error }, { status: 400 });

    // A day or session a PUBLISHED timetable uses can't go (unpublish it first);
    // in drafts, exams on a removed day / session simply become unplaced.
    const days = new Set(d.days);
    const sessionIds = new Set(s.sessions.map((x) => x.id));
    const tts = (await refs.timetables.where("planId", "==", planId).get()).docs.map((x) => ({ ref: x.ref, t: x.data() as MidTimetable }));
    const blocked = tts.filter(({ t }) => t.status === "PUBLISHED" && t.slots.some((sl) => !days.has(sl.date) || !sessionIds.has(sl.sessionId)));
    if (blocked.length) {
      return NextResponse.json({ error: `Published timetables use a day or session you removed (${blocked.map(({ t }) => t.branch).join(", ")}) - unpublish them first` }, { status: 409 });
    }
    // Each branch's usual session (only sessions that still exist) and the exams-a-day limit.
    const branchSessions: Record<string, string> = {};
    for (const [k, v] of Object.entries((body.branchSessions ?? plan.branchSessions ?? {}) as Record<string, unknown>)) {
      if (typeof v === "string" && sessionIds.has(v)) branchSessions[k] = v;
    }
    const maxPerDay = body.maxPerDay === undefined ? plan.maxPerDay ?? DEFAULT_MAX_PER_DAY : Number(body.maxPerDay);
    if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > MAX_SESSIONS) return NextResponse.json({ error: `Exams a day must be 1 to ${MAX_SESSIONS}` }, { status: 400 });
    const name = await actorName(db, session.collegeId, session.uid);
    const batch = db.batch();
    batch.update(refs.plans.doc(planId), { days: d.days, sessions: s.sessions, branchSessions, maxPerDay, updatedBy: session.uid, updatedByName: name, updatedAt: new Date() });
    for (const { ref, t } of tts) {
      if (t.status !== "DRAFT") continue;
      const kept = t.slots.filter((sl) => days.has(sl.date) && sessionIds.has(sl.sessionId));
      if (kept.length !== t.slots.length) batch.update(ref, { slots: kept, rev: (t.rev ?? 0) + 1, updatedAt: new Date() });
    }
    await batch.commit();
    return NextResponse.json({ plan: { ...plan, days: d.days, sessions: s.sessions, branchSessions, maxPerDay } });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-timetables/[planId] PATCH]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_TIMETABLE_EDITORS);
    const { planId } = await params;
    const db = getAdminDb();
    const refs = midTimetableRefs(db, session.collegeId);
    const tts = await refs.timetables.where("planId", "==", planId).get();
    if (tts.docs.some((d) => (d.data() as MidTimetable).status === "PUBLISHED")) {
      return NextResponse.json({ error: "Some branch timetables are published - unpublish them first" }, { status: 409 });
    }
    const batch = db.batch();
    tts.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(refs.plans.doc(planId));
    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[college/mid-timetables/[planId] DELETE]");
  }
}
