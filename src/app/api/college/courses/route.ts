export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getRelatedDepartmentIds } from "@/lib/departments/scope";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "PANEL_MEMBER", "EXAM_CELL", "DEAN");
    const { searchParams } = new URL(request.url);
    let departmentId = searchParams.get("departmentId");

    const db = getAdminDb();

    if (!departmentId && session.role === "HOD") {
      const userSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      const deptName = (userSnap.data() as { department?: string } | undefined)?.department;
      if (deptName) {
        const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments")
          .where("name", "==", deptName).limit(1).get();
        if (deptSnap.empty) {
          departmentId = "__none__";
        } else {
          // A sub-department never owns courses of its own - it shares its
          // parent's program - so a sub-HOD resolves courses against the
          // parent instead, same fallback already used for section creation.
          const deptData = deptSnap.docs[0].data() as { parentDepartmentId?: string };
          departmentId = deptData.parentDepartmentId ?? deptSnap.docs[0].id;
        }
      }
    }

    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courses") as FirebaseFirestore.Query;

    if (departmentId && departmentId !== "__none__") {
      // A department fed by another (e.g. IT fed by Basic Science's shared
      // 1st-year course - see resolveSubjectDepartment) never owns a course
      // of its own for that shared year, so its Course dropdown falls back to
      // the feeder's course - same relationship subjects/route.ts already
      // uses for visibility.
      const relatedIds = await getRelatedDepartmentIds(db, session.collegeId, departmentId);
      query = relatedIds.length > 1
        ? query.where("departmentId", "in", relatedIds)
        : query.where("departmentId", "==", departmentId);
    } else if (departmentId === "__none__") {
      query = query.where("departmentId", "==", "__none__");
    }

    const snap = await query.get();
    const courses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ courses });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/courses GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      departmentId: string;
      catalogId: string;
    };

    const { departmentId, catalogId } = body;
    if (!departmentId || !catalogId) {
      return NextResponse.json({ error: "departmentId and catalogId are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // A department course can only be created from a catalog entry the Principal
    // fixed - name/code/duration come from there so they can never drift.
    const catalogSnap = await collegeRef.collection("courseCatalog").doc(catalogId).get();
    if (!catalogSnap.exists) {
      return NextResponse.json({ error: "Selected course is not in the catalog" }, { status: 400 });
    }
    const catalog = catalogSnap.data() as { name: string; code: string; durationYears: number; isActive?: boolean };
    if (catalog.isActive === false) {
      return NextResponse.json({ error: "Selected course is inactive" }, { status: 400 });
    }

    // Don't let the same course be added to a department twice.
    const dupe = await collegeRef.collection("courses")
      .where("departmentId", "==", departmentId)
      .where("catalogId", "==", catalogId)
      .limit(1)
      .get();
    if (!dupe.empty) {
      return NextResponse.json({ error: "This course is already added to the department" }, { status: 409 });
    }

    const now = new Date();
    const ref = await collegeRef
      .collection("courses")
      .add({
        collegeId: session.collegeId,
        departmentId,
        catalogId,
        name: catalog.name,
        code: catalog.code,
        durationYears: Number(catalog.durationYears),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/courses POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
