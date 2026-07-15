export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

const YEAR_LABELS: Record<number, string> = { 1: "1st Year", 2: "2nd Year", 3: "3rd Year", 4: "4th Year" };

// ADMINISTRATION (LOCATION-scoped) manages this for colleges in its own location;
// PRINCIPAL manages it for their own college; SUPER_ADMIN for any college.
// requireCollegeContext resolves collegeId from the session (Principal) or the
// `?collegeId=` query param (Administration/Super Admin, who carry no collegeId).
async function assertCollegeInScope(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  role: string,
  locationId: string
): Promise<boolean> {
  if (role !== "ADMINISTRATION") return true;
  const snap = await db.collection("colleges").doc(collegeId).get();
  return (snap.data() as { locationId?: string } | undefined)?.locationId === locationId;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "ADMINISTRATION", "PRINCIPAL", "HOD");
    const db = getAdminDb();

    if (!(await assertCollegeInScope(db, session.collegeId, session.role, session.locationId))) {
      return NextResponse.json({ error: "College not in your location" }, { status: 403 });
    }

    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("academicYears")
      .orderBy("yearNumber")
      .get();

    const academicYears = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ academicYears });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-years GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "ADMINISTRATION", "PRINCIPAL");
    const body = (await request.json()) as { yearNumber: number; isActive?: boolean };
    const yearNumber = Number(body.yearNumber);

    if (![1, 2, 3, 4].includes(yearNumber)) {
      return NextResponse.json({ error: "yearNumber must be 1-4" }, { status: 400 });
    }

    const db = getAdminDb();
    if (!(await assertCollegeInScope(db, session.collegeId, session.role, session.locationId))) {
      return NextResponse.json({ error: "College not in your location" }, { status: 403 });
    }

    const collection = db.collection("colleges").doc(session.collegeId).collection("academicYears");

    // One doc per yearNumber — reuse existing doc if it's already there.
    const existing = await collection.where("yearNumber", "==", yearNumber).limit(1).get();
    const now = new Date();

    if (!existing.empty) {
      const ref = existing.docs[0].ref;
      await ref.update({ isActive: body.isActive ?? true, updatedAt: now });
      return NextResponse.json({ id: ref.id }, { status: 200 });
    }

    const ref = await collection.add({
      collegeId: session.collegeId,
      yearNumber,
      label: YEAR_LABELS[yearNumber],
      isActive: body.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-years POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
