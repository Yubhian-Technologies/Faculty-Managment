export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { MAX_FACE_SAMPLES, isValidDescriptor } from "@/lib/attendance/faceThreshold";
import { registeredSamplesOf, resolveOwnDocRef } from "@/lib/attendance/faceRegistry";

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
    const registered = samples.length > 0;
    return NextResponse.json({ registered, embedding: registered ? samples[0] : null, embeddings: samples });
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
// Upserts, so a faculty member can re-register (e.g. after a haircut throws
// off match confidence) by simply registering again.
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

    await ref.update({
      // The first sample stays in `faceEmbedding` - every "is registered" check reads that field.
      faceEmbedding: embeddings[0],
      faceEmbeddingSamples: embeddings.map((v) => ({ v })),
      faceRegisteredAt: new Date(),
    });

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
