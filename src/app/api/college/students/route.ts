export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import type { Section, StudentRecord, StudentStatus } from "@/types";

// Sections a PANEL_MEMBER (faculty) is in charge of - students are only visible/
// editable within these. Returns [] if the faculty isn't assigned to any section.
async function getInchargeSections(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<Section[]> {
  const candidateIds = await getFacultyIdCandidates(db, collegeId, uid);
  const snap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("sections")
    .where("facultyInchargeUid", "in", candidateIds)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Section);
}

async function getHodDept(db: FirebaseFirestore.Firestore, collegeId: string, uid: string): Promise<string> {
  const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  return (snap.data() as { department?: string } | undefined)?.department ?? "";
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { searchParams } = new URL(request.url);
    const sectionFilter = searchParams.get("section");
    const yearFilter = searchParams.get("year");

    const db = getAdminDb();
    const studentsColl = db.collection("colleges").doc(session.collegeId).collection("students");
    const withCommonFilters = (q: FirebaseFirestore.Query): FirebaseFirestore.Query => {
      let out = q;
      if (sectionFilter) out = out.where("section", "==", sectionFilter);
      if (yearFilter) out = out.where("year", "==", Number(yearFilter));
      return out;
    };

    let primaryQuery: FirebaseFirestore.Query = studentsColl;
    // Only HOD has a narrower-than-college scope with a meaningful "secondary"
    // (view-only) counterpart - either a student pre-registered to this HOD's
    // department while primarily owned by another (e.g. Basic Science), or a
    // student who belongs to one of this HOD's own sub-departments (parent
    // HOD gets automatic view-only access). Every other role here already
    // sees the whole college unscoped, so nothing they see is ever "secondary".
    let secondaryQuery: FirebaseFirestore.Query | null = null;
    let childDeptQuery: FirebaseFirestore.Query | null = null;

    if (session.role === "PANEL_MEMBER") {
      const sections = await getInchargeSections(db, session.collegeId, session.uid);
      if (sections.length === 0) {
        return NextResponse.json({ students: [] });
      }
      // Section *names* aren't unique across years or departments (e.g. "A" exists
      // in both Year 1 and Year 2, and independently in both CSE and AIDS) - a
      // single `where("section", "in", names)` would silently pull in every other
      // year's/department's same-named section too. Match each in-charge section
      // by its exact (department, name, year) triple instead, one query per
      // section, then merge. This is also what implicitly pins the student to the
      // right *course*: StudentRecord has no courseId of its own, so a student's
      // course is only ever determined by which Section (department+courseId+
      // name+year) they're enrolled in - matching that exact triple is matching
      // the exact section, and therefore the exact course.
      const sectionSnaps = await Promise.all(
        sections.slice(0, 30).map((s) =>
          withCommonFilters(
            studentsColl.where("department", "==", s.department).where("section", "==", s.name).where("year", "==", s.year)
          ).get()
        )
      );
      const seen = new Set<string>();
      const students: (Omit<StudentRecord, "id"> & { id: string; accessLevel: "primary" | "secondary" })[] = [];
      for (const snap of sectionSnaps) {
        for (const d of snap.docs) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          students.push({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: "primary" });
        }
      }
      students.sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? ""));
      return NextResponse.json({ students });
    } else if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (scope.departmentName) {
        primaryQuery = primaryQuery.where("department", "==", scope.departmentName);
        secondaryQuery = withCommonFilters(studentsColl.where("secondaryDepartment", "==", scope.departmentName));
      }
      if (scope.childDepartmentNames.length > 0) {
        childDeptQuery = withCommonFilters(studentsColl.where("department", "in", scope.childDepartmentNames));
      }
    }

    primaryQuery = withCommonFilters(primaryQuery);

    const [primarySnap, secondarySnap, childDeptSnap] = await Promise.all([
      primaryQuery.get(),
      secondaryQuery ? secondaryQuery.get() : Promise.resolve(null),
      childDeptQuery ? childDeptQuery.get() : Promise.resolve(null),
    ]);

    const seenIds = new Set<string>();
    const students: (Omit<StudentRecord, "id"> & { id: string; accessLevel: "primary" | "secondary" })[] = [];
    for (const d of primarySnap.docs) {
      seenIds.add(d.id);
      students.push({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: "primary" });
    }
    // Sub-department students are "primary": a parent HOD runs the whole
    // department tree. Only genuinely cross-listed students - registered to an
    // unrelated department and merely pre-registered here - stay view-only.
    // Same split as the sections route.
    if (childDeptSnap) {
      for (const d of childDeptSnap.docs) {
        if (seenIds.has(d.id)) continue;
        seenIds.add(d.id);
        students.push({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: "primary" });
      }
    }
    if (secondarySnap) {
      for (const d of secondarySnap.docs) {
        if (seenIds.has(d.id)) continue;
        seenIds.add(d.id);
        students.push({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: "secondary" });
      }
    }
    students.sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? ""));

    return NextResponse.json({ students });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Faculty (PANEL_MEMBER) can view their sections' rosters but cannot add
// students - that stays with HOD/Office/above.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const body = (await request.json()) as {
      rollNumber: string;
      name: string;
      section: string;
      year: number;
      status?: StudentStatus;
    };

    if (!body.rollNumber?.trim() || !body.name?.trim() || !body.section?.trim() || !body.year) {
      return NextResponse.json({ error: "rollNumber, name, section, year are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const sectionsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("sections")
      .where("name", "==", body.section.trim().toUpperCase())
      .where("year", "==", Number(body.year))
      .limit(1)
      .get();

    if (sectionsSnap.empty) {
      return NextResponse.json({ error: "Section not found" }, { status: 400 });
    }
    const sectionDoc = sectionsSnap.docs[0].data() as Section;

    if (session.role === "HOD") {
      const dept = await getHodDept(db, session.collegeId, session.uid);
      if (dept && sectionDoc.department !== dept) {
        return NextResponse.json({ error: "Section is not in your department" }, { status: 403 });
      }
    }

    const now = new Date();
    const studentRef = db.collection("colleges").doc(session.collegeId).collection("students").doc();
    const history = departmentHistoryEntry(
      db, session.collegeId, studentRef.id, sectionDoc.department, sectionDoc.name, Number(body.year), now
    );

    const batch = db.batch();
    batch.set(studentRef, {
      collegeId: session.collegeId,
      department: sectionDoc.department,
      section: sectionDoc.name,
      year: Number(body.year),
      rollNumber: body.rollNumber.trim(),
      name: body.name.trim(),
      status: body.status ?? "REGULAR",
      createdAt: now,
      updatedAt: now,
    });
    batch.set(history.ref, history.data);
    await batch.commit();

    return NextResponse.json({ id: studentRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
