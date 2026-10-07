export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import type { StudentRecord } from "@/types";

// A student's own profile photo. The student record is the source of truth (every roster, attendance sheet and the
// profile page read it); the login (users/{uid}) and systemUsers mirror only feed the top-bar avatar. All three are
// written in ONE batch, so the photo can never be updated in one place and not the others.
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const body = (await readJsonBody(request)) as { photoUrl?: unknown };
    const photoUrl = body.photoUrl;
    if (typeof photoUrl !== "string") return NextResponse.json({ error: "photoUrl is required" }, { status: 400 });
    // "" clears the photo - anything else must be a real upload of this student's own.
    if (photoUrl !== "") {
      if (!photoUrl.startsWith("https://firebasestorage.googleapis.com/")) return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
      if (!photoUrl.includes(encodeURIComponent(`profile-photos/${session.uid}_`))) {
        return NextResponse.json({ error: "Photo does not belong to this user" }, { status: 403 });
      }
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(2).get();
    if (studentSnap.size !== 1) {
      return NextResponse.json({ error: "Your login is not linked to a student record yet. Please contact your College Office." }, { status: 404 });
    }
    const studentDoc = studentSnap.docs[0];
    const student = studentDoc.data() as StudentRecord;
    if (passwordChangeRequired(student)) return passwordChangeRequiredResponse();

    const now = new Date();
    const userRef = collegeRef.collection("users").doc(session.uid);
    const batch = db.batch();
    // The record stores a cleared photo as null (same as the Office's photo edit).
    batch.update(studentDoc.ref, { profilePhotoUrl: photoUrl || null, updatedAt: now });
    if ((await userRef.get()).exists) batch.update(userRef, { profilePhotoUrl: photoUrl, updatedAt: now });
    batch.set(db.collection("systemUsers").doc(session.uid), { profilePhotoUrl: photoUrl }, { merge: true });
    await batch.commit();

    await writeAuditLogSafe(db, session.collegeId, {
      action: "STUDENT_PHOTO_UPDATED", performedBy: session.uid, performedByName: student.name, targetId: studentDoc.id,
      details: { self: true, name: student.name, rollNumber: student.rollNumber, cleared: photoUrl === "" },
    });
    return NextResponse.json({ ok: true, photoUrl });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/photo PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
