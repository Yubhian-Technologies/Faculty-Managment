export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT is read-only - this route only implements GET.
export async function GET() {
  try {
    await requireManagement();

    const db = getAdminDb();
    const snap = await db.collection("colleges").orderBy("name").get();
    const colleges = snap.docs.map((d) => ({ ...d.data(), id: d.id }));

    return NextResponse.json({ colleges });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[management/colleges GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
