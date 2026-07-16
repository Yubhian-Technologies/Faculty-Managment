export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function PATCH(request: Request) {
  try {
    // Self-service only — the target uid always comes from the verified session,
    // never from the request body, so a user can only ever update their own photo.
    const session = await requireCollegeMember(
      "PRINCIPAL",
      "VICE_PRINCIPAL",
      "HOD",
      "PANEL_MEMBER",
      "COLLEGE_OFFICE",
      "ACCOUNTS",
      "FINANCE",
      "PURCHASE_DEPT"
    );

    const body = (await request.json()) as { photoUrl?: string };
    const photoUrl = body.photoUrl;

    if (photoUrl === undefined) {
      return NextResponse.json({ error: "photoUrl is required" }, { status: 400 });
    }
    // Empty string clears the photo — everything else must be a real upload of ours.
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

    await userRef.update({ profilePhotoUrl: photoUrl, updatedAt: now });
    await db.collection("systemUsers").doc(session.uid).set({ profilePhotoUrl: photoUrl }, { merge: true });

    const actorName = (userSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "PROFILE_PHOTO_UPDATED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: session.uid,
      timestamp: now,
    });

    return NextResponse.json({ ok: true, photoUrl });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users/me/photo PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
