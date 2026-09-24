export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Activate/deactivate a location-scoped user (ADMINISTRATION / ACCOUNTS / etc).
// MANAGEMENT gets this alongside Super Admin because it can already create these
// users (POST /api/admin/users) - this closes the loop so it can also offboard
// or re-enable them without hard-deleting the account.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    await requireRole("SUPER_ADMIN", "MANAGEMENT");

    const { uid } = await params;
    const body = (await request.json()) as { locationId?: string; isActive?: boolean };
    const { locationId, isActive } = body;

    if (!locationId || isActive === undefined) {
      return NextResponse.json({ error: "locationId and isActive required" }, { status: 400 });
    }

    const db = getAdminDb();
    await db
      .collection("locations")
      .doc(locationId)
      .collection("locationUsers")
      .doc(uid)
      .update({ isActive, updatedAt: new Date() });

    // Best-effort: the Firestore write above is what the app enforces live
    // (see liveRoles.ts's short-TTL re-check for LOCATION-scoped sessions) -
    // this additionally stops the old login/token from being used immediately,
    // mirroring lib/roles/seats.ts's retireAccount.
    try {
      const { getAdminAuth } = await import("@/lib/firebase/admin");
      const auth = await getAdminAuth();
      await auth.updateUser(uid, { disabled: !isActive });
      await auth.revokeRefreshTokens(uid);
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/users/[uid] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
