export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findUsersByRoles } from "@/lib/roles/findUsersByRoles";
import { midSources } from "@/lib/exams/seatingPairedServer";
import { cleanRules, DEFAULT_INVIGILATION_RULES } from "@/lib/invigilation/rules";
import { actorName, INVIGILATION_READ_ROLES, invigilationError, schedulesCol } from "@/lib/invigilation/server";
import type { InvigilationSchedule } from "@/types/invigilation";

// Invigilation schedules: GET = the list, plus what a new one can cover (the
// Mid timetables) and who may be named an override approver (Exam Cell
// logins); POST (Exam Cell) = a new schedule for some Mid timetables.

export async function GET() {
  try {
    const session = await requireCollegeMember(...INVIGILATION_READ_ROLES);
    const db = getAdminDb();
    const [snap, sources, examCell] = await Promise.all([
      schedulesCol(db, session.collegeId).get(),
      midSources(db, session.collegeId),
      findUsersByRoles(db, session.collegeId, ["EXAM_CELL"]),
    ]);
    const schedules = snap.docs.map((d) => ({ ...(d.data() as InvigilationSchedule), id: d.id }))
      .sort((a, b) => (b.days[0] ?? "").localeCompare(a.days[0] ?? "") || a.name.localeCompare(b.name));
    return NextResponse.json({
      schedules,
      mids: sources.map((s) => ({ id: s.id, label: s.label, days: s.days, branches: s.branches })),
      approvers: examCell.map((d) => ({ uid: d.id, name: (d.data() as { name?: string; email?: string }).name ?? (d.data() as { email?: string }).email ?? d.id })),
      defaults: DEFAULT_INVIGILATION_RULES,
    });
  } catch (err) {
    return invigilationError(err, "[invigilation/schedules GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const body = (await readJsonBody(request)) as { name?: string; midPlanIds?: string[]; rules?: unknown };
    const db = getAdminDb();
    const sources = await midSources(db, session.collegeId);
    const midPlanIds = [...new Set((body.midPlanIds ?? []).map(String))].filter((id) => sources.some((s) => s.id === id));
    if (!midPlanIds.length) return NextResponse.json({ error: "Pick at least one Mid timetable" }, { status: 400 });
    const picked = sources.filter((s) => midPlanIds.includes(s.id));
    const name = String(body.name ?? "").trim() || picked.map((s) => s.label).join(" + ");
    const { rules, errors } = cleanRules({ ...DEFAULT_INVIGILATION_RULES, ...((body.rules as object) ?? {}) });
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
    const ref = schedulesCol(db, session.collegeId).doc();
    const doc: Omit<InvigilationSchedule, "id"> = {
      collegeId: session.collegeId, name, midPlanIds, days: [...new Set(picked.flatMap((s) => s.days))].sort(), status: "ACTIVE",
      rules, publishedSessions: [], createdBy: session.uid, createdByName: await actorName(db, session.collegeId, session.uid, session.email || "Exam Cell"),
      createdAt: new Date(), updatedAt: new Date(),
    };
    await ref.set(doc);
    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    return invigilationError(err, "[invigilation/schedules POST]");
  }
}
