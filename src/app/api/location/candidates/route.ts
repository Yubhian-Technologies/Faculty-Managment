export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET() {
  try {
    const session = await verifySession();
    const allowed = ["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "LOCATION_DEPT_HEAD"];
    if (!session || !allowed.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const db = getAdminDb();
    const snap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationCandidates")
      .orderBy("createdAt", "desc")
      .get();

    const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("[location/candidates GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
