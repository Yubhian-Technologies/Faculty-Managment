export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

const GLOBAL_ROLES = ["SUPER_ADMIN", "MANAGEMENT", "FINANCE", "PURCHASE_DEPT"];

export async function PATCH(request: Request) {
  try {
    // Self-service only - the target uid always comes from the verified session,
    // never from the request body, so a user can only ever update their own photo.
    const session = await requireRole(...GLOBAL_ROLES);

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
    const userRef = db.collection("systemUsers").doc(session.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await userRef.update({ profilePhotoUrl: photoUrl });

    return NextResponse.json({ ok: true, photoUrl });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users/me/photo PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
