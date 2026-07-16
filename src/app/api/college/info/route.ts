export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(
      request,
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS", "FINANCE", "PURCHASE_DEPT"
    );
    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).get();
    const data = snap.data() as { name?: string; phone?: string; email?: string; address?: string } | undefined;

    return NextResponse.json({
      name: data?.name ?? "Sri Vishnu Educational Society",
      phone: data?.phone ?? "",
      email: data?.email ?? "",
      address: data?.address ?? "",
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/info GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
