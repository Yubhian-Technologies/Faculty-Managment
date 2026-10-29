export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { getHodDepartmentScope, canHodManageFacultyDepartment } from "@/lib/departments/scope";
import { cleanFacultyOrder, facultyOrderRef, MAX_FACULTY_ORDER } from "@/lib/faculty/facultyOrder";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

// The HOD's own arrangement of one department's faculty list ("Arrange Order" on the Staff Profiles page).
// The list routes read it (lib/faculty/facultyOrder.ts); this route is the only writer.

type Department = { name: string };

/** The department, if this HOD may arrange its faculty (own department or a true sub-department). */
async function authorizeDepartment(db: FirebaseFirestore.Firestore, collegeId: string, uid: string, departmentId: string) {
  const snap = await db.collection("colleges").doc(collegeId).collection("departments").doc(departmentId).get();
  const dept = snap.data() as Department | undefined;
  if (!dept?.name) return null;
  const scope = await getHodDepartmentScope(db, collegeId, uid, { activeOnly: false });
  return canHodManageFacultyDepartment(scope, dept.name) ? dept : null;
}

const millis = (v: unknown): number | null => (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null;

// Body: { departmentId, order: facultyId[], expectedUpdatedAt?: number | null }.
// An empty `order` resets the department to the default order (deletes the document).
// expectedUpdatedAt, when sent, is the `updatedAt` (ms) the caller last saw (null = no arrangement): a different value is a 409.
export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const body = (await readJsonBody(request)) as { departmentId?: unknown; order?: unknown; expectedUpdatedAt?: unknown } | null;
    const departmentId = typeof body?.departmentId === "string" ? body.departmentId : "";
    if (!departmentId) return NextResponse.json({ error: "departmentId is required" }, { status: 400 });

    const db = getAdminDb();
    const dept = await authorizeDepartment(db, session.collegeId, session.uid, departmentId);
    if (!dept) return NextResponse.json({ error: "You can only arrange your own department's faculty" }, { status: 403 });

    const memberSnap = await db.collection("colleges").doc(session.collegeId).collection("facultyMembers")
      .where("department", "==", dept.name).select().get();
    const order = cleanFacultyOrder(body?.order, new Set(memberSnap.docs.map((d) => d.id)));
    if (!order) {
      return NextResponse.json({ error: `The order must be a list of at most ${MAX_FACULTY_ORDER} faculty ids` }, { status: 400 });
    }

    const ref = facultyOrderRef(db, session.collegeId, departmentId);
    const expected = body?.expectedUpdatedAt;
    const conflict = await db.runTransaction(async (tx) => {
      const current = millis((await tx.get(ref)).data()?.updatedAt);
      if (expected !== undefined && expected !== current) return true;
      if (order.length === 0) tx.delete(ref);
      else tx.set(ref, { order, updatedAt: FieldValue.serverTimestamp(), updatedByUid: session.uid });
      return false;
    });
    if (conflict) {
      return NextResponse.json({ error: "The order was changed by someone else - reload and try again" }, { status: 409 });
    }

    await writeAuditLogSafe(db, session.collegeId, {
      action: "FACULTY_ORDER_CHANGED",
      performedBy: session.uid,
      targetId: departmentId,
      details: { department: dept.name, count: order.length, reset: order.length === 0 },
    });
    return NextResponse.json({ ok: true, count: order.length });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-order PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
