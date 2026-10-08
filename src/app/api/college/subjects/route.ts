export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { claimSubjectKey, isSubjectKeyTaken } from "@/lib/subjects/subjectKeys";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { SubjectCategory, SubjectType } from "@/types";
import { SUBJECT_CATEGORY_LABELS } from "@/types";
import { getRelatedDepartmentNames } from "@/lib/departments/scope";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "COLLEGE_STAFF", "EXAM_CELL", "ACADEMICS");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const catalogId = searchParams.get("catalogId");
    const academicYear = searchParams.get("academicYear");
    const regulation = searchParams.get("regulation");
    const sessionRegulations = (searchParams.get("regulations") ?? "").split(",").map((r) => r.trim()).filter(Boolean);

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges").doc(session.collegeId).collection("subjects");

    // Master subjects (courseId present) never carry a `department` field -
    // they're course+regulation scoped, department-independent by design
    // (see this file's POST for the two creation shapes) - so this filter
    // only applies to the semester-scoped shape. Applying it unconditionally
    // used to AND it onto the courseId query below, which a master subject
    // (no `department` field at all) can never match - every HOD got an
    // empty Master Collection for every course, always.
    if (session.role === "HOD" && !courseId && !catalogId) {
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

    if (catalogId) {
      // Which specific department's Course doc a master subject's courseId
      // happens to point to is an implementation detail, not a real
      // ownership boundary - every department teaching this same catalog
      // course (same CourseCatalogItem, different departmentId, different
      // Course doc) is meant to share one subject pool (see this file's
      // POST doc-comment). Resolve every department's Course doc for this
      // catalogId first, then match subjects against the whole set, so a
      // subject entered once (under any one department's Course doc) is
      // visible - and, via Assign to Semester, assignable - to every other
      // department offering the same course, not just whichever one
      // happened to receive it. Firestore caps `in` at 30 values, same as
      // the department fan-out above.
      const coursesSnap = await db.collection("colleges").doc(session.collegeId)
        .collection("courses").where("catalogId", "==", catalogId).get();
      const courseIds = coursesSnap.docs.map((d) => d.id).slice(0, 30);
      if (courseIds.length === 0) {
        return NextResponse.json({ subjects: [], academicYears: [] });
      }
      query = query.where("courseId", "in", courseIds);
    } else if (courseId) {
      query = query.where("courseId", "==", courseId);
    }

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
          if (sy && sy !== academicYear) return false;
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
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
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
    const body = (await readJsonBody(request)) as {
      courseId?: string;
      semester?: number;
      name: string;
      code: string;
      shortCode?: string;
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
      departmentId?: string;
      year?: number;
      /** "Don't include in teaching load" - stored as isNonTeachingLoad + excludeFromResume (see subjects/[id] PATCH). */
      excludeFromTeachingLoad?: boolean;
    };

    if (!body.name?.trim() || !body.code?.trim()) {
      return NextResponse.json({ error: "name and code are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();
    const loadFlags = body.excludeFromTeachingLoad === true ? { isNonTeachingLoad: true, excludeFromResume: true } : {};

    if (body.courseId) {
      const { courseId } = body;
      const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(courseId).get();
      if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
      const course = courseSnap.data() as { name: string; departmentId: string; durationYears: number; catalogId?: string };

      // Optional - a subject can be added for a course even when no
      // regulation currently resolves for it. When one IS provided, it must
      // belong to this course's own Course Catalog entry - a Pharmacy-only
      // code should never be accepted for a B.Tech subject. A master
      // subject has no ordinal year of its own (see this route's own POST
      // body type), so there's no batch/year to resolve it against here -
      // that congruence check only makes sense once a real batch exists
      // (Section.batch - see sections/route.ts POST, which is where it's
      // actually enforced). Here we only check "is this regulation one the
      // catalog has ever assigned to this course at all".
      const regulation = body.regulation?.trim();
      if (regulation) {
        const catalogSnap = course.catalogId
          ? await db.collection("colleges").doc(session.collegeId).collection("courseCatalog").doc(course.catalogId).get()
          : null;
        const catalogData = catalogSnap?.exists
          ? (catalogSnap.data() as { regulations?: string[] })
          : undefined;
        const catalogRegulations = catalogData?.regulations ?? [];
        if (!catalogRegulations.includes(regulation)) {
          return NextResponse.json(
            { error: `That regulation isn't assigned to ${course.name}. Check Course Catalog.` },
            { status: 400 },
          );
        }
      }

      if (body.serialNumber == null || Number.isNaN(Number(body.serialNumber))) {
        return NextResponse.json({ error: "S.No. is required" }, { status: 400 });
      }
      if (!body.category || !body.category.trim()) {
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

      // ── Duplicate-code check ────────────────────────────────────────────
      // Same regulation+code within this catalog course, in ANY department
      // that teaches it - a master subject is department-independent (see
      // this route's own GET doc-comment), so a duplicate created under a
      // sibling department's Course doc must be caught too, matching
      // MasterSubjectImportService's own duplicate detection (bulk import).
      // This single-add path (also used by the Import page's "Fix and
      // retry" dialog) previously had no check at all. Falls back to just
      // this courseId for a legacy Course doc with no catalogId.
      const code = body.code.toUpperCase().trim();
      const regKey = (regulation ?? "").trim();
      const targetDeptId = body.departmentId;

      // Duplicate check: scoped per department (or course if no departmentId) + regulation + code
      const dupeQuery = targetDeptId
        ? db.collection("colleges").doc(session.collegeId).collection("subjects")
            .where("departmentId", "==", targetDeptId)
        : db.collection("colleges").doc(session.collegeId).collection("subjects")
            .where("courseId", "==", courseId);

      const dupeSnap = await dupeQuery.get();
      let existingSubjectId: string | undefined;
      const hasDupe = dupeSnap.docs.some((d) => {
        const data = d.data() as { code?: string; name?: string; regulation?: string; semester?: number; year?: number };
        // Same code AND name: the caller may reuse this subject instead of adding a copy.
        if ((data.code ?? "").toUpperCase() === code && (data.regulation ?? "").trim() === regKey
          && (data.name ?? "").trim().toLowerCase() === body.name!.trim().toLowerCase()) {
          existingSubjectId = d.id;
        }
        const sameCode = (data.code ?? "").toUpperCase() === code;
        const sameReg = (data.regulation ?? "").trim() === regKey;
        if (body.semester && data.semester != null) {
          return sameCode && sameReg && data.semester === Number(body.semester) && (body.year == null || data.year == null || data.year === Number(body.year));
        }
        return sameCode && sameReg;
      });

      if (hasDupe) {
        return NextResponse.json(
          { error: `A subject with code "${code}" already exists for this regulation and department.`, existingSubjectId },
          { status: 409 },
        );
      }

      const ref = db.collection("colleges").doc(session.collegeId).collection("subjects").doc();
      const category = body.category;
      const customCategory = body.category === "OTHER" ? body.customCategory!.trim() : undefined;

      const subjectDoc = {
        collegeId: session.collegeId,
        courseId,
        courseName: course.name,
        ...(targetDeptId ? { departmentId: targetDeptId } : {}),
        academicYear: body.academicYear,
        regulation: regulation,
        year: body.year != null ? Number(body.year) : undefined,
        semester: body.semester != null ? Number(body.semester) : undefined,
        serialNumber: Number(body.serialNumber),
        category,
        ...(customCategory ? { customCategory } : {}),
        name: body.name.trim(),
        code,
        shortCode: body.shortCode?.trim() ? body.shortCode.trim().toUpperCase() : code,
        hoursPerWeek: body.hoursPerWeek != null ? Number(body.hoursPerWeek) : 0,
        totalHoursPerSemester: body.totalHoursPerSemester != null ? Number(body.totalHoursPerSemester) : null,
        lectureHours: Number(body.lectureHours),
        tutorialHours: Number(body.tutorialHours),
        practicalHours: Number(body.practicalHours),
        credits: body.credits != null ? Number(body.credits) : 0,
        type: body.type ?? "THEORY",
        ...loadFlags,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      const lockScope = targetDeptId
        ? `${course.catalogId || courseId}_${targetDeptId}`
        : (course.catalogId || courseId);

      try {
        await db.runTransaction(async (tx) => {
          await claimSubjectKey(tx, db, session.collegeId, { scope: lockScope, regulation: regKey, code }, ref);
          tx.set(ref, subjectDoc);
        });
      } catch (e) {
        if (isSubjectKeyTaken(e)) {
          return NextResponse.json({ error: `A subject with code "${code}" already exists for this regulation and department.` }, { status: 409 });
        }
        throw e;
      }

      let assignmentDoc = null;
      if (body.departmentId && body.semester) {
        const { buildSubjectInstancePayload } = await import("@/lib/subjects/services/SubjectInstanceService");
        const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").doc(body.departmentId).get();
        const deptName = deptSnap.exists ? (deptSnap.data() as { name?: string }).name : undefined;

        assignmentDoc = buildSubjectInstancePayload(
          { id: ref.id, ...subjectDoc } as any,
          {
            collegeId: session.collegeId,
            subjectId: ref.id,
            courseId,
            departmentId: body.departmentId,
            departmentName: deptName,
            year: body.year != null ? Number(body.year) : 1,
            semester: Number(body.semester),
            createdAt: now,
            now,
          }
        );
        await db.collection("colleges").doc(session.collegeId)
          .collection("subjectSemesterAssignments")
          .doc(assignmentDoc.id)
          .set(assignmentDoc);
      }

      return NextResponse.json({ id: ref.id, subject: { id: ref.id, ...subjectDoc }, assignment: assignmentDoc }, { status: 201 });
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
      ...(body.shortCode?.trim() ? { shortCode: body.shortCode.trim().toUpperCase() } : {}),
      semester: Number(body.semester),
      hoursPerWeek: Number(body.hoursPerWeek) || 0,
      credits: Number(body.credits) || 0,
      type: body.type ?? "THEORY",
      ...loadFlags,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}