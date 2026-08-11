export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

const LOCATION_ROLES = ["ADMINISTRATION", "HR_ADMIN", "ADMIN_OFFICE", "LOCATION_DEPT_HEAD", "ACCOUNTS"];

export async function PATCH(request: Request) {
  try {
    // Self-service only - the target uid always comes from the verified session,
    // never from the request body, so a user can only ever update their own photo.
    const session = await requireLocationMember(...LOCATION_ROLES);

    const body = (await request.json()) as { photoUrl?: string };
    const photoUrl = body.photoUrl;

    if (photoUrl === undefined) {
      return NextResponse.json({ error: "photoUrl is required" }, { status: 400 });
    }
    if (photoUrl !== "") {
      if (!photoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
        return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
      }
      if (!photoUrl.includes(encodeURIComponent(`profile-photos/${session.uid}_`))) {
        return NextResponse.json({ error: "Photo does not belong to this user" }, { status: 403 });
      }
    }

    const db = getAdminDb();
    const userRef = db
      .collection("locations").doc(session.locationId)
      .collection("locationUsers").doc(session.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const now = new Date();
    await userRef.update({ profilePhotoUrl: photoUrl, updatedAt: now });
    await db.collection("systemUsers").doc(session.uid).set({ profilePhotoUrl: photoUrl }, { merge: true });

    return NextResponse.json({ ok: true, photoUrl });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/users/me/photo PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
