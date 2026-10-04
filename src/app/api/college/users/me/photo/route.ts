export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { setLinkedFacultyPhoto } from "@/lib/faculty/syncFacultyPhoto";

export async function PATCH(request: Request) {
  try {
    // Self-service only - the target uid always comes from the verified session,
    // never from the request body, so a user can only ever update their own photo.
    const session = await requireCollegeMember(
      "PRINCIPAL",
      "VICE_PRINCIPAL",
      "HOD",
      "PANEL_MEMBER",
      "COLLEGE_OFFICE",
      "COLLEGE_STAFF",
      "ACADEMICS",
      "IQAC_COORDINATOR",
      "T_AND_P",
      "R_AND_D",
      "PLACEMENT_DEPT",
      "LIBRARY",
      "EXAM_CELL",
      "WEBMASTER",
      "COLLEGE_ACCOUNTS"
    );

    const body = (await readJsonBody(request)) as { photoUrl?: string };
    const photoUrl = body.photoUrl;

    if (photoUrl === undefined) {
      return NextResponse.json({ error: "photoUrl is required" }, { status: 400 });
    }
    // Empty string clears the photo - everything else must be a real upload of ours.
    if (photoUrl !== "") {
      if (!photoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
        return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
      }
      // Must point at a photo this session uploaded for itself.
      if (!photoUrl.includes(encodeURIComponent(`profile-photos/${session.uid}_`))) {
        return NextResponse.json({ error: "Photo does not belong to this user" }, { status: 403 });
      }
    }

    const db = getAdminDb();
    const now = new Date();

    const userRef = db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // A faculty/HOD login's photo belongs to their faculty record (the source of truth every faculty
    // list reads); write that FIRST, then the users/systemUsers mirror below. No linked faculty record
    // (Principal, office staff, ...) => nothing to do here, same as before.
    await setLinkedFacultyPhoto(db, session.collegeId, session.uid, photoUrl);
    await userRef.update({ profilePhotoUrl: photoUrl, updatedAt: now });
    await db.collection("systemUsers").doc(session.uid).set({ profilePhotoUrl: photoUrl }, { merge: true });

    const actorName = (userSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    await writeAuditLogSafe(db, session.collegeId, { action: "PROFILE_PHOTO_UPDATED", performedBy: session.uid, performedByName: actorName, targetId: session.uid });

    return NextResponse.json({ ok: true, photoUrl });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users/me/photo PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
