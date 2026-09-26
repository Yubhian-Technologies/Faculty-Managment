export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { FacultyAssignedModule, FacultyAssignedModulesDoc } from "@/types";

const MODULES_COL = "facultyAssignedModules";

function modulesRef(db: ReturnType<typeof getAdminDb>, collegeId: string, uid: string) {
  return db.collection("colleges").doc(collegeId).collection(MODULES_COL).doc(uid);
}

export async function GET() {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF", "COLLEGE_OFFICE"
    );
    const db = getAdminDb();
    const snap = await modulesRef(db, session.collegeId, session.uid).get();
    const data = snap.exists ? (snap.data() as FacultyAssignedModulesDoc) : null;
    return NextResponse.json({ modules: data?.modules ?? [] });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/modules GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { modules?: FacultyAssignedModule[] };
const db = getAdminDb();
      const now = Timestamp.fromDate(new Date());
      const docRef = modulesRef(db, session.collegeId, session.uid);
      const modules = (body.modules ?? []).filter((m): m is FacultyAssignedModule =>
        ["timetable-incharge", "lab-batches", "teaching-load", "assignment-requests", "attendance", "leave-approvals", "students"].includes(m)
      );
      const existingSnap = await docRef.get();
      const existingData = existingSnap.exists ? (existingSnap.data() as FacultyAssignedModulesDoc) : null;
      await docRef.set({
        uid: session.uid,
        collegeId: session.collegeId,
        facultyId: session.uid,
        modules,
        assignedBy: session.uid,
        updatedAt: now,
        createdAt: existingData?.createdAt ?? now,
      } as FacultyAssignedModulesDoc, { merge: true });
    return NextResponse.json({ modules });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/modules POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
