export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(
      request,
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS", "COLLEGE_ACCOUNTS", "FINANCE", "PURCHASE_DEPT",
      "COLLEGE_STAFF", "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER", "STUDENT"
    );
    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).get();
    const data = snap.data() as {
      name?: string;
      code?: string;
      affiliation?: string;
      phone?: string;
      contactPhone?: string;
      email?: string;
      contactEmail?: string;
      address?: string;
      type?: string;
      logoUrl?: string;
    } | undefined;

    return NextResponse.json({
      name: data?.name ?? "",
      code: data?.code ?? "",
      affiliation: data?.affiliation ?? "",
      phone: data?.contactPhone || data?.phone || "",
      email: data?.contactEmail || data?.email || "",
      address: data?.address ?? "",
      type: data?.type,
      logoUrl: data?.logoUrl ?? "",
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/info GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
