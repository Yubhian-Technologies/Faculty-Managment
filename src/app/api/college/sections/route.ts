export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";

async function getHodDept(db: FirebaseFirestore.Firestore, collegeId: string, uid: string): Promise<string> {
  const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  return (snap.data() as { department?: string } | undefined)?.department ?? "";
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_OFFICE");
    const { searchParams } = new URL(request.url);
    const yearFilter = searchParams.get("year");
    const courseFilter = searchParams.get("courseId");

    const db = getAdminDb();
    const sectionsColl = db.collection("colleges").doc(session.collegeId).collection("sections");
    const withCommonFilters = (q: FirebaseFirestore.Query): FirebaseFirestore.Query => {
      let out = q;
      if (courseFilter) out = out.where("courseId", "==", courseFilter);
      if (yearFilter) out = out.where("year", "==", Number(yearFilter));
      return out;
    };

    let primaryQuery: FirebaseFirestore.Query = sectionsColl;
    // A parent HOD gets full ("primary") access to their own sub-departments'
    // sections too — they own the whole department tree, same as the
    // sub-HOD who runs that sub-department day to day (see
    // assertHodOwnsSection in sections/[id]/route.ts, which mirrors this).
    // The one case that stays genuinely "secondary" (view-only) is a section
    // explicitly cross-listed to this department via `secondaryDepartments`
    // (inherited from the owning Department at creation) — a different,
    // unrelated top-level department's section, not part of this HOD's own
    // tree. Same shape as the students route.
    let childDeptQuery: FirebaseFirestore.Query | null = null;
    let secondaryDeptQuery: FirebaseFirestore.Query | null = null;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (scope.departmentName) {
        primaryQuery = primaryQuery.where("department", "==", scope.departmentName);
        secondaryDeptQuery = withCommonFilters(sectionsColl.where("secondaryDepartments", "array-contains", scope.departmentName));
      }
      if (scope.childDepartmentNames.length > 0) {
        childDeptQuery = withCommonFilters(sectionsColl.where("department", "in", scope.childDepartmentNames));
      }
    } else if (session.role === "PANEL_MEMBER") {
      primaryQuery = primaryQuery.where("facultyInchargeUid", "==", session.uid);
    }

    primaryQuery = withCommonFilters(primaryQuery);

    const [primarySnap, childDeptSnap, secondaryDeptSnap] = await Promise.all([
      primaryQuery.get(),
      childDeptQuery ? childDeptQuery.get() : Promise.resolve(null),
      secondaryDeptQuery ? secondaryDeptQuery.get() : Promise.resolve(null),
    ]);

    const seenIds = new Set<string>();
    const sections: { id: string; accessLevel: "primary" | "secondary"; [key: string]: unknown }[] = [];
    for (const d of primarySnap.docs) {
      seenIds.add(d.id);
      sections.push({ id: d.id, ...d.data(), accessLevel: "primary" });
    }
    if (childDeptSnap) {
      for (const d of childDeptSnap.docs) {
        if (seenIds.has(d.id)) continue;
        seenIds.add(d.id);
        sections.push({ id: d.id, ...d.data(), accessLevel: "primary" });
      }
    }
    if (secondaryDeptSnap) {
      for (const d of secondaryDeptSnap.docs) {
        if (seenIds.has(d.id)) continue;
        seenIds.add(d.id);
        sections.push({ id: d.id, ...d.data(), accessLevel: "secondary" });
      }
    }
    sections.sort((a, b) => {
      const ya = (a.year as number | undefined) ?? 0;
      const yb = (b.year as number | undefined) ?? 0;
      if (ya !== yb) return ya - yb;
      return ((a.name as string | undefined) ?? "").localeCompare((b.name as string | undefined) ?? "");
    });

    // `studentCount` used to be a manually-typed capacity estimate ("Student
    // Intake"); now that rosters are actually imported, overwrite it with the
    // real enrolled count per (department, section, year) instead of trusting
    // the stored field, which nothing writes anymore.
    const deptNames = Array.from(new Set(sections.map((s) => s.department as string).filter(Boolean)));
    if (deptNames.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < deptNames.length; i += 30) chunks.push(deptNames.slice(i, i + 30));

      const studentSnaps = await Promise.all(
        chunks.map((chunk) =>
          db.collection("colleges").doc(session.collegeId).collection("students")
            .where("department", "in", chunk)
            .get()
        )
      );

      const countMap = new Map<string, number>();
      for (const snap of studentSnaps) {
        for (const d of snap.docs) {
          const s = d.data() as { department?: string; section?: string; year?: number };
          const key = `${s.department ?? ""}|${s.section ?? ""}|${s.year ?? 0}`;
          countMap.set(key, (countMap.get(key) ?? 0) + 1);
        }
      }

      for (const sec of sections) {
        const key = `${sec.department as string}|${sec.name as string}|${sec.year as number}`;
        sec.studentCount = countMap.get(key) ?? 0;
      }
    }

    return NextResponse.json({ sections });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const body = (await request.json()) as {
      courseId: string;
      name: string;
      year: number;
      batch: string;
      studentCount?: number;
      facultyInchargeUid?: string;
      facultyInchargeName?: string;
      departmentId?: string;
      secondaryDepartment?: string;
    };

    if (!body.courseId || !body.name?.trim() || !body.year || !body.batch?.trim()) {
      return NextResponse.json({ error: "courseId, name, year, batch are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(body.courseId).get();
    if (!courseSnap.exists) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    const course = courseSnap.data() as { name: string; durationYears: number; departmentId?: string };
    if (Number(body.year) < 1 || Number(body.year) > course.durationYears) {
      return NextResponse.json({ error: `Year must be between 1 and ${course.durationYears} for ${course.name}` }, { status: 400 });
    }

    // Reject years the college hasn't opened via Academic Years. Colleges that have
    // never configured any academic years yet are left unrestricted (no doc to check
    // against), so this only enforces once someone has actually set the list up.
    const academicYearsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("academicYears")
      .get();
    if (!academicYearsSnap.empty) {
      const activeYears = new Set(
        academicYearsSnap.docs
          .map((d) => d.data() as { yearNumber: number; isActive: boolean })
          .filter((y) => y.isActive)
          .map((y) => y.yearNumber)
      );
      if (!activeYears.has(Number(body.year))) {
        return NextResponse.json({ error: `Year ${body.year} is not open for this college` }, { status: 400 });
      }
    }

    // Resolve the owning department: HOD uses their own. Principal/VP/Office
    // pick a department explicitly (a course can be shared by a parent
    // department and its sub-departments, e.g. BS's "B.Sc" course is also
    // used by BS-Physics/BS-Maths — so the course's own departmentId alone
    // can no longer determine which one a new section belongs to). Fall back
    // to deriving it from the course for any older caller that doesn't send
    // departmentId.
    let dept = "";
    if (session.role === "HOD") {
      dept = await getHodDept(db, session.collegeId, session.uid);
    } else if (body.departmentId) {
      const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").doc(body.departmentId).get();
      if (!deptSnap.exists) {
        return NextResponse.json({ error: "Department not found" }, { status: 404 });
      }
      const deptData = deptSnap.data() as { name?: string; parentDepartmentId?: string };
      if (course.departmentId !== body.departmentId && course.departmentId !== deptData.parentDepartmentId) {
        return NextResponse.json({ error: "Selected course does not belong to this department" }, { status: 400 });
      }
      dept = deptData.name ?? "";
    } else if (course.departmentId) {
      const courseDeptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").doc(course.departmentId).get();
      dept = (courseDeptSnap.data() as { name?: string } | undefined)?.name ?? "";
    }

    // A department can only hold sections for years the Principal/VP has
    // actually assigned it (see Department.assignedYears) — otherwise the
    // year-allocation feature is purely decorative. This same lookup also
    // validates the section's own cross-listed (secondary) department — a
    // department/sub-department can be configured with several possible
    // destinations (e.g. a shared first-year sub-department feeding both CSE
    // and ECE), but each individual section commits to exactly one, since
    // its whole cohort promotes into that one branch together.
    let secondaryDepartments: string[] = [];
    if (dept) {
      const deptSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("departments")
        .where("name", "==", dept)
        .limit(1)
        .get();
      if (!deptSnap.empty) {
        const deptDoc = deptSnap.docs[0].data() as { assignedYears?: number[]; secondaryDepartments?: string[] };
        const assignedYears = deptDoc.assignedYears ?? [];
        if (assignedYears.length > 0 && !assignedYears.includes(Number(body.year))) {
          return NextResponse.json(
            { error: `Your department is not assigned to teach Year ${body.year}` },
            { status: 400 }
          );
        }
        const availableSecondaryDepts = deptDoc.secondaryDepartments ?? [];
        const chosen = body.secondaryDepartment?.trim()
          || (availableSecondaryDepts.length === 1 ? availableSecondaryDepts[0] : "");
        if (chosen) {
          if (!availableSecondaryDepts.includes(chosen)) {
            return NextResponse.json(
              { error: `"${chosen}" is not one of this department's configured secondary departments` },
              { status: 400 }
            );
          }
          secondaryDepartments = [chosen];
        }
      }
    }

    const now = new Date();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sections").doc();

    await ref.set({
      collegeId: session.collegeId,
      department: dept,
      ...(secondaryDepartments.length > 0 ? { secondaryDepartments } : {}),
      courseId: body.courseId,
      courseName: course.name,
      name: body.name.trim().toUpperCase(),
      year: Number(body.year),
      batch: body.batch.trim(),
      facultyInchargeUid: body.facultyInchargeUid ?? null,
      facultyInchargeName: body.facultyInchargeName ?? "",
      studentCount: body.studentCount != null ? Math.max(0, Number(body.studentCount)) : 0,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
