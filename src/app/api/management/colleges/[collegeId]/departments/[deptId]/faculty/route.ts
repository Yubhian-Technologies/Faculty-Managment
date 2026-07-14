export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT is read-only — this route only implements GET.
export async function GET(_request: Request, { params }: { params: Promise<{ collegeId: string; deptId: string }> }) {
  try {
    await requireManagement();
    const { collegeId, deptId } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);
    const [collegeSnap, deptSnap] = await Promise.all([
      collegeRef.get(),
      collegeRef.collection("departments").doc(deptId).get(),
    ]);
    const collegeName = (collegeSnap.data() as { name?: string } | undefined)?.name ?? "";
    const deptData = deptSnap.data() as { name?: string; hodUid?: string } | undefined;
    const deptName = deptData?.name ?? "";

    const [facultySnap, hodSnap] = await Promise.all([
      collegeRef.collection("facultyMembers").where("department", "==", deptName).get(),
      deptData?.hodUid ? collegeRef.collection("users").doc(deptData.hodUid).get() : Promise.resolve(null),
    ]);

    const faculty = facultySnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    const hod = hodSnap?.exists ? { uid: hodSnap.id, ...hodSnap.data() } : null;

    return NextResponse.json({ faculty, collegeName, hod });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/departments/faculty GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
