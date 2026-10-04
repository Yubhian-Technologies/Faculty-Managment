export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { EMBEDDING_LENGTH } from "@/lib/attendance/faceThreshold";
import { resolveOwnDocRef } from "@/lib/attendance/faceRegistry";

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
    const data = snap.data() as { faceEmbedding?: number[] } | undefined;
    const registered = Array.isArray(data?.faceEmbedding) && data.faceEmbedding.length === EMBEDDING_LENGTH;
    return NextResponse.json({ registered, embedding: registered ? data!.faceEmbedding : null });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/face-registration GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Stores the face descriptor (128 floats, ~1KB) captured client-side by
// face-api.js during Register - never the image itself, and never the
// HOD-managed profilePhotoUrl, which this deliberately leaves untouched.
// Upserts, so a faculty member can re-register (e.g. after a haircut throws
// off match confidence) by simply registering again.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    const body = (await request.json()) as { embedding?: number[] };
    const embedding = body.embedding;

    if (
      !Array.isArray(embedding) ||
      embedding.length !== EMBEDDING_LENGTH ||
      !embedding.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      return NextResponse.json({ error: "Invalid face data — please try registering again" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = await resolveOwnDocRef(db, session.collegeId, session.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Your account record could not be found" }, { status: 404 });
    }

    await ref.update({
      faceEmbedding: embedding,
      faceRegisteredAt: new Date(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/face-registration POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
