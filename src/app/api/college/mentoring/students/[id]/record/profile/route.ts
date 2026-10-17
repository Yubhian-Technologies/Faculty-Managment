export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorOf } from "@/lib/audit/actorOf";
import { authorizeMentoringStudent, isManagingHod } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { buildRecordProfile, cleanProfileOverrides } from "@/lib/mentoring/profileRecord";
import { loadProfileOverrides, profileDocRef } from "@/lib/mentoring/recordStore";

// A mentor fills in details that page 1 / 7.1 of the record shows as missing. What the student (or the
// College Office) already holds is never touched - this only adds, to a separate document, what
// the student's record lacks, and the student's own value wins as soon as one exists. A blank
// value takes the mentor's own entry back. The HOD who manages the student may also correct details the
// student's record holds; that correction is kept apart and shown instead of the student's value.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { values?: unknown };

    const db = getAdminDb();
    const access = await authorizeMentoringStudent(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const student = access.student as unknown as Record<string, unknown>;
    const current = await loadProfileOverrides(db, session.collegeId, id);
    const isHod = await isManagingHod(db, session, access.student);
    const clean = cleanProfileOverrides(student, current, body.values, isHod);
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: clean.status });

    if (Object.keys(clean.values).length > 0) {
      const actor = await actorOf(db, session.collegeId, session.uid, session.email);
      const overrides: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(clean.values)) overrides[k] = v === "" ? FieldValue.delete() : v;
      await profileDocRef(db, session.collegeId, id).set(
        { overrides, updatedAt: new Date(), updatedByUid: session.uid, updatedByName: actor.name },
        { merge: true }
      );
    }
    const saved = await loadProfileOverrides(db, session.collegeId, id);
    return NextResponse.json({ via: access.via, ...buildRecordProfile(student, saved, isHod) });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id]/record/profile PATCH]");
  }
}
