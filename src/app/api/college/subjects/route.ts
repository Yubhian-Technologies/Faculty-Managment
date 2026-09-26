export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { SubjectCategory, SubjectType } from "@/types";
import { SUBJECT_CATEGORY_LABELS } from "@/types";
import { getRelatedDepartmentNames } from "@/lib/departments/scope";
import { regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "COLLEGE_STAFF", "EXAM_CELL", "ACADEMICS");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const academicYear = searchParams.get("academicYear");
    const regulation = searchParams.get("regulation");
    const sessionRegulations = (searchParams.get("regulations") ?? "").split(",").map((r) => r.trim()).filter(Boolean);

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges").doc(session.collegeId).collection("subjects");

    if (session.role === "HOD") {
      // Viewing is bidirectional: a parent HOD sees their own
      // department's subjects and every sub-department's, AND a sub-HOD
      // (e.g. BS-Chemistry, BS-Mathematics) sees their parent's (Basic
      // Science) subjects too, since a sub-department's students are
      // taught under the parent's program/courses rather than owning
      // their own. Firestore caps `in` at 30 values.
      const { getHodDepartmentScope } = await import("@/lib/departments/scope");
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const relatedNameLists = await Promise.all(
        scope.ownDepartmentNames.map((n) => getRelatedDepartmentNames(db, session.collegeId, n))
      );
      const names = Array.from(new Set([...relatedNameLists.flat(), ...scope.managedDepartmentNames]));
      if (names.length === 1) {
        query = query.where("department", "==", names[0]);
      } else if (names.length > 1) {
        query = query.where("department", "in", names.slice(0, 30));
      }
    }

    if (courseId) query = query.where("courseId", "==", courseId);

    const snap = await query.get();
    let subjects = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    // Every session that actually has a subject for this selection - feeds the
    // History dropdown, so it lists real data rather than a fixed window.
    const academicYears = Array.from(new Set(
      subjects
        .map((s) => (s as { academicYear?: string }).academicYear)
        .filter((y): y is string => !!y)
    )).sort().reverse();

    // Academics-only filter - a subject with no academicYear at all
    // still matches any session rather than silently disappearing.
    if (academicYear) {
      const seenCore = new Set<string>();
      subjects = subjects.filter((s) => {
        const { academicYear: sy, regulation: sr, category, code } = s as { academicYear?: string; regulation?: string; category?: string; code?: string };
        const isElective = category === "PEC" || category === "OEC";
        if (!isElective && sr && sessionRegulations.length > 0) {
          if (!sessionRegulations.includes(sr)) return false;
          const key = `${sr}|${(code ?? "").trim().toLowerCase()}`;
          if (code && seenCore.has(key)) return false;
          seenCore.add(key);
          return true;
        }
        return !sy || sy === academicYear;
      });
    }

    // Same leniency as academicYear above - a subject with no regulation set
    // still matches any filter rather than disappearing.
    if (regulation) {
      subjects = subjects.filter((s) => {
        const sr = (s as { regulation?: string }).regulation;
        return !sr || sr === regulation;
      });
    }

    return NextResponse.json({ subjects, academicYears });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Two independent creation shapes share this collection: master subjects
// (Academics/Principal/VP/Super Admin - courseId + regulation, no
// department/year) and semester-scoped subjects (HOD Teaching
// Assignments page - semester + department, no course link).
// Branch on which fields the caller sent.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const body = (await request.json()) as {
      courseId?: string;
      semester?: number;
      name: string;
      code: string;
      hoursPerWeek?: number;
      totalHoursPerSemester?: number;
      credits?: number;
      type?: SubjectType;
      department?: string;
      academicYear?: string;
      regulation?: string;
      serialNumber?: number;
      category?: SubjectCategory;
      customCategory?: string;
      lectureHours?: number;
      tutorialHours?: number;
      practicalHours?: number;
    };

    if (!body.name?.trim() || !body.code?.trim()) {
      return NextResponse.json({ error: "name and code are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    if (body.courseId) {
      const { courseId } = body;
      const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(courseId).get();
      if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
      const course = courseSnap.data() as { name: string; departmentId: string; durationYears: number; catalogId?: string };

      // Optional - a subject can be added for a course even when no
      // regulation currently resolves for it. When one IS provided,
      // it must still belong to this course's own Course Catalog
      // entry - a Pharmacy-only code should never be accepted for
      // a B.Tech subject. The master subject is scoped by course
      // + regulation only (no year), so we check against all
      // regulations assigned to this course.
      const regulation = body.regulation?.trim();
      if (regulation) {
        const catalogSnap = course.catalogId
          ? await db.collection("colleges").doc(session.collegeId).collection("courseCatalog").doc(course.catalogId).get()
          : null;
        const catalogData = catalogSnap?.exists
          ? (catalogSnap.data() as { regulations?: string[]; regulationBatches?: Record<string, string> })
          : undefined;
        const catalogRegulations = catalogData?.regulations ?? [];
        // When regulationBatches data exists, resolve which regulations
        // apply to this course (all of them, since the master subject
        // has no year). Otherwise fall back to the catalog's own
        // regulation list.
        let applicableRegulations: string[];
        if (catalogData?.regulationBatches && Object.keys(catalogData.regulationBatches).length > 0) {
          const allBatchYears = Object.values(catalogData.regulationBatches).map(Number);
          const minYear = Math.min(...allBatchYears);
          const maxYear = Math.max(...allBatchYears);
          applicableRegulations = regulationsForCourseYearByBatch(
            catalogData.regulationBatches,
            minYear,
            undefined,
            catalogData?.regulations,
          );
        } else {
          applicableRegulations = catalogRegulations;
        }
        if (applicableRegulations.length > 0) {
          if (!applicableRegulations.includes(regulation)) {
            return NextResponse.json(
              { error: `That regulation isn't assigned to ${course.name}. Check Course Catalog.` },
              { status: 400 },
            );
          }
        } else if (!catalogRegulations.includes(regulation)) {
          return NextResponse.json(
            { error: `That regulation isn't assigned to ${course.name}. Check Course Catalog.` },
            { status: 400 },
          );
        }
      }

      if (body.serialNumber == null || Number.isNaN(Number(body.serialNumber))) {
        return NextResponse.json({ error: "S.No. is required" }, { status: 400 });
      }
      if (!body.category || !(body.category in SUBJECT_CATEGORY_LABELS)) {
        return NextResponse.json({ error: "A valid category is required" }, { status: 400 });
      }
      if (body.category === "OTHER" && !body.customCategory?.trim()) {
        return NextResponse.json({ error: "Enter a name for the custom category" }, { status: 400 });
      }
      if (body.lectureHours == null || body.tutorialHours == null || body.practicalHours == null) {
        return NextResponse.json({ error: "L, T and P are required" }, { status: 400 });
      }

      // Master subject creation is Academics/Principal/VP/Super Admin only.
      if (session.role === "HOD") {
        return NextResponse.json(
          { error: "Add this subject from Teaching Assignments instead - the master Subjects form isn't available to HOD." },
          { status: 403 },
        );
      }

      const ref = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("subjects")
        .add({
          collegeId: session.collegeId,
          courseId,
          courseName: course.name,
          academicYear: body.academicYear,
          regulation: regulation,
          serialNumber: Number(body.serialNumber),
          category: body.category,
          ...(body.category === "OTHER" ? { customCategory: body.customCategory!.trim() } : {}),
          name: body.name.trim(),
          code: body.code.toUpperCase().trim(),
          hoursPerWeek: body.hoursPerWeek != null ? Number(body.hoursPerWeek) : 0,
          totalHoursPerSemester: body.totalHoursPerSemester != null ? Number(body.totalHoursPerSemester) : null,
          lectureHours: Number(body.lectureHours),
          tutorialHours: Number(body.tutorialHours),
          practicalHours: Number(body.practicalHours),
          credits: body.credits != null ? Number(body.credits) : 0,
          type: body.type ?? "THEORY",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });

      return NextResponse.json({ id: ref.id }, { status: 201 });
    }

    if (!body.semester) {
      return NextResponse.json({ error: "name, code, semester are required" }, { status: 400 });
    }

    let department = body.department ?? "";
    if (session.role === "HOD") {
      const { getHodDepartmentScope, canHodEditDepartment } = await import("@/lib/departments/scope");
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!body.department?.trim() && scope.ownDepartmentNames.length > 1) {
        return NextResponse.json(
          { error: "You manage more than one department - specify which department this subject belongs to" },
          { status: 400 },
        );
      }
      department = body.department?.trim() || scope.ownDepartmentNames[0] || "";
      if (!canHodEditDepartment(scope, department)) {
        return NextResponse.json(
          { error: "That department is not yours or one of your sub-departments" },
          { status: 403 },
        );
      }
    }

    if (!department) {
      return NextResponse.json({ error: "department is required" }, { status: 400 });
    }

    const ref = await db.collection("colleges").doc(session.collegeId).collection("subjects").add({
      collegeId: session.collegeId,
      department,
      name: body.name.trim(),
      code: body.code.trim().toUpperCase(),
      semester: Number(body.semester),
      hoursPerWeek: Number(body.hoursPerWeek) || 0,
      credits: Number(body.credits) || 0,
      type: body.type ?? "THEORY",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}