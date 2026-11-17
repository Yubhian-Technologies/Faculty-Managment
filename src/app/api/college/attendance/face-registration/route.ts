export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { MAX_FACE_SAMPLES, isValidDescriptor } from "@/lib/attendance/faceThreshold";
import { registeredSamplesOf, resolveOwnDocRef } from "@/lib/attendance/faceRegistry";
import { CHANGE_REGISTRATION_MESSAGE, listPasskeys, selfCheckInMethod } from "@/lib/attendance/passkeys";
import { noticeRegistration } from "@/lib/attendance/registrationNotice";

// Whether the caller has registered their face yet - the gate the Faculty/HOD
// attendance pages use to decide whether to offer "Register" or "Check In" -
// plus the stored embedding itself, so MarkAttendanceDialog can run the
// actual comparison client-side exactly like it always has (only the
// resulting match distance/boolean is ever sent back to the server).
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    const db = getAdminDb();
    const ref = await resolveOwnDocRef(db, session.collegeId, session.uid);
    const snap = await ref.get();
    const samples = registeredSamplesOf(snap.data() as { faceEmbedding?: unknown; faceEmbeddingSamples?: unknown } | undefined);
    const faceRegistered = samples.length > 0;
    // `registered` = ready to check in by the college's Self Check-In Method (the attendance pages' gate):
    // FACE - a face; PASSKEY - a registered phone; EITHER - either one.
    const method = await selfCheckInMethod(db, session.collegeId);
    const phones = method === "FACE" ? 0 : (await listPasskeys(db, session.collegeId, session.uid)).length;
    const registered = method === "FACE" ? faceRegistered : method === "PASSKEY" ? phones > 0 : faceRegistered || phones > 0;
    return NextResponse.json({ registered, faceRegistered, phones, method, embedding: faceRegistered ? samples[0] : null, embeddings: samples });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/attendance/face-registration GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}

// Stores the face descriptors (128 floats each, ~1KB; up to MAX_FACE_SAMPLES) captured client-side by
// face-api.js during Register - never the image itself, and never the
// HOD-managed profilePhotoUrl, which this deliberately leaves untouched.
// Only when nothing is registered yet: to register again (a changed look, a mismatch), the HOD /
// Principal resets it first (face-registration/reset).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    // `embeddings`: a few samples from consecutive frames (MarkAttendanceDialog); `embedding`: one (older pages).
    const body = (await readJsonBody(request)) as { embedding?: unknown; embeddings?: unknown };
    const samples = (Array.isArray(body.embeddings) ? body.embeddings : body.embedding !== undefined ? [body.embedding] : [])
      .slice(0, MAX_FACE_SAMPLES);
    if (samples.length === 0 || !samples.every(isValidDescriptor)) {
      return NextResponse.json({ error: "Invalid face data — try registering again" }, { status: 400 });
    }
    const embeddings = samples as number[][];

    const db = getAdminDb();
    const ref = await resolveOwnDocRef(db, session.collegeId, session.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Your account record could not be found" }, { status: 404 });
    }
    // Registering again over an existing face is not self-service - otherwise anyone signed in as this person
    // could put their own face on the account. The HOD / Principal resets it (face-registration/reset) first.
    if (registeredSamplesOf(snap.data() as { faceEmbedding?: unknown; faceEmbeddingSamples?: unknown }).length > 0) {
      return NextResponse.json({ error: `Your face is already registered. ${CHANGE_REGISTRATION_MESSAGE}` }, { status: 409 });
    }

    await ref.update({
      // The first sample stays in `faceEmbedding` - every "is registered" check reads that field.
      faceEmbedding: embeddings[0],
      faceEmbeddingSamples: embeddings.map((v) => ({ v })),
      faceRegisteredAt: new Date(),
    });

    await noticeRegistration(db, session.collegeId, { event: "FACE_REGISTERED", personUid: session.uid, actorUid: session.uid });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/attendance/face-registration POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
