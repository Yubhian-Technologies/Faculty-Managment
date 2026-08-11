export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Firebase Storage download URLs don't send Access-Control-Allow-Origin, so
// loading them directly into an <img> works (display only) but reading pixel
// data via canvas — which face-api.js needs to compute a face descriptor —
// gets blocked as a tainted-canvas security violation. Proxying the bytes
// through our own origin sidesteps that without needing bucket-level CORS
// config. Self-serve only: always the caller's own reference photo.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const db = getAdminDb();
    const facultySnap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("facultyMembers")
      .where("userUid", "==", session.uid)
      .limit(1)
      .get();

    const photoUrl = facultySnap.empty
      ? undefined
      : (facultySnap.docs[0].data() as { profilePhotoUrl?: string }).profilePhotoUrl;
    if (!photoUrl) {
      return NextResponse.json({ error: "No profile photo on file" }, { status: 404 });
    }

    const upstream = await fetch(photoUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Failed to fetch reference photo" }, { status: 502 });
    }

    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/reference-photo GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
