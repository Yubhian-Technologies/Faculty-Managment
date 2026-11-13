export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { authorizeMentoringStudent } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { PARENT_DETAIL_LABELS, buildParentDetailsUpdate, parentDetailsOf, type ParentDetailKey } from "@/lib/students/parentDetails";
import type { StudentRecord } from "@/types";

// A student's parent / guardian details, corrected from the Mentoring Record by the student's mentor, the HOD who
// manages them, the Principal / Vice Principal (or the College Office). Writes the STUDENT'S OWN record - the one copy
// My Profile, the Students page and the mentoring record all read. Students can't change these themselves.

const ROLES = ["PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE"];
const COLLEGE_WIDE = new Set(["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE"]);

async function authorize(db: Firestore, session: { collegeId: string; uid: string; role: string }, id: string) {
  if (COLLEGE_WIDE.has(session.role)) {
    const snap = await db.collection("colleges").doc(session.collegeId).collection("students").doc(id).get();
    if (!snap.exists) return { ok: false as const, status: 404, error: "Student not found. The record may have been deleted." };
    return { ok: true as const, student: { ...(snap.data() as StudentRecord), id: snap.id } };
  }
  const access = await authorizeMentoringStudent(db, session, id);
  return access.ok ? { ok: true as const, student: access.student } : access;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const { id } = await params;
    const access = await authorize(getAdminDb(), session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    return NextResponse.json({ canEdit: true, values: parentDetailsOf(access.student), labels: PARENT_DETAIL_LABELS });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/parent-details GET]");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const access = await authorize(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = (await readJsonBody(request)) as { details?: unknown };
    const result = buildParentDetailsUpdate(access.student, body?.details);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    const fields = Object.keys(result.updates) as ParentDetailKey[];
    if (fields.length === 0) return NextResponse.json({ values: parentDetailsOf(access.student), changed: [] });

    await db.collection("colleges").doc(session.collegeId).collection("students").doc(id).update({ ...result.updates, updatedAt: new Date() });
    const me = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    await writeAuditLogSafe(db, session.collegeId, {
      action: "STUDENT_DETAILS_UPDATED", performedBy: session.uid, performedByName: (me.data()?.name as string) || session.email || "Unknown", targetId: id,
      details: { via: "Mentoring Record - parent details", role: session.role, fields: fields.map((f) => PARENT_DETAIL_LABELS[f]) },
    });
    return NextResponse.json({ values: parentDetailsOf({ ...access.student, ...result.updates }), changed: fields });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/parent-details PATCH]");
  }
}
