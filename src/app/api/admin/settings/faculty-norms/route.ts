export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin, requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { FacultyNorms } from "@/types";

const CONFIG_COLLECTION = "platformConfig";
const NORMS_DOC = "facultyNorms";

const DEFAULT_NORMS: Omit<FacultyNorms, "updatedAt" | "updatedByName"> = {
  regulatoryBody: "UGC",
  studentFacultyRatio: 15,
  teachingHoursPerWeek: 16,
  defaultMinFacultyPerDept: 3,
  minimumQualifications: {
    assistantProfessor: "M.Phil / NET / Ph.D",
    associateProfessor: "Ph.D with NET",
    professor: "Ph.D with 10 years experience",
  },
  positionNorms: [
    { designation: "Professor", minQualification: "Ph.D", minExperienceYears: 10, requiredPerDept: 1 },
    { designation: "Associate Professor", minQualification: "Ph.D", minExperienceYears: 5, requiredPerDept: 2 },
    { designation: "Assistant Professor", minQualification: "M.Phil / NET", minExperienceYears: 0, requiredPerDept: 3 },
  ],
};

export async function GET() {
  try {
    await requireRole("SUPER_ADMIN", "PRINCIPAL", "HOD");

    const db = getAdminDb();
    const snap = await db.collection(CONFIG_COLLECTION).doc(NORMS_DOC).get();

    const norms = snap.exists ? { ...DEFAULT_NORMS, ...snap.data() } : DEFAULT_NORMS;

    return NextResponse.json({ norms });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/settings/faculty-norms GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSuperAdmin();

    const body = (await request.json()) as Partial<FacultyNorms>;

    const db = getAdminDb();
    const now = new Date();

    // Fetch updater's name
    let updatedByName = "Super Admin";
    const userSnaps = await db.collectionGroup("users").where("uid", "==", session.uid).limit(1).get();
    if (!userSnaps.empty) {
      updatedByName = (userSnaps.docs[0].data() as { name?: string }).name ?? "Super Admin";
    }

    const norms: Omit<FacultyNorms, "updatedAt"> & { updatedAt: Date } = {
      regulatoryBody: body.regulatoryBody ?? "UGC",
      studentFacultyRatio: Number(body.studentFacultyRatio ?? DEFAULT_NORMS.studentFacultyRatio),
      teachingHoursPerWeek: Number(body.teachingHoursPerWeek ?? DEFAULT_NORMS.teachingHoursPerWeek),
      defaultMinFacultyPerDept: Number(body.defaultMinFacultyPerDept ?? DEFAULT_NORMS.defaultMinFacultyPerDept),
      minimumQualifications: body.minimumQualifications ?? DEFAULT_NORMS.minimumQualifications,
      positionNorms: body.positionNorms ?? DEFAULT_NORMS.positionNorms,
      updatedAt: now,
      updatedByName,
    };

    await db.collection(CONFIG_COLLECTION).doc(NORMS_DOC).set(norms);

    await db.collection("auditLogs").add({
      action: "FACULTY_NORMS_UPDATED",
      performedBy: session.uid,
      performedByName: updatedByName,
      details: { regulatoryBody: norms.regulatoryBody },
      timestamp: now,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/settings/faculty-norms PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
