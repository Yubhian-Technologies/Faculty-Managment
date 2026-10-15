export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getRelatedDepartmentNames } from "@/lib/departments/scope";
import { whereIn, type QueryLike } from "@/lib/firestore/inQuery";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { SubjectMasterService } from "@/lib/subjects/services/SubjectMasterService";
import type { SubjectRowInput } from "@/lib/subjects/validation/SubjectValidator";

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
    let query: QueryLike = db.collection("colleges").doc(session.collegeId).collection("subjects") as unknown as QueryLike;

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
        query = whereIn(query, "department", names);
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
      // the department fan-out above (both now run one query per 30 values instead of dropping the rest).
      const coursesSnap = await db.collection("colleges").doc(session.collegeId)
        .collection("courses").where("catalogId", "==", catalogId).get();
      const courseIds = coursesSnap.docs.map((d) => d.id);
      if (courseIds.length === 0) {
        return NextResponse.json({ subjects: [], academicYears: [] });
      }
      query = whereIn(query, "courseId", courseIds);
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
    return subjectErrorResponse(err, "[college/subjects GET]");
  }
}

// Creates ONE master subject under a Course (catalog) + Regulation. A master has no department,
// year or semester: it is assigned to a semester afterwards with Assign by code
// (subject-semester-assignments/assign-by-code). Bulk creation is subjects/import.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const body = (await readJsonBody(request)) as SubjectRowInput & { courseId?: string; regulation?: string };
    if (!body.courseId) return NextResponse.json({ error: "Select a course first." }, { status: 400 });
    if (!body.regulation?.trim()) return NextResponse.json({ error: "Select a regulation first." }, { status: 400 });

    const result = await new SubjectMasterService().importMany({
      collegeId: session.collegeId,
      courseId: body.courseId,
      regulation: body.regulation,
      records: [body],
      actor: { uid: session.uid, name: session.email },
    });
    if (result.failed.length > 0) {
      const first = result.failed[0];
      return NextResponse.json({ error: first.error }, { status: first.kind === "duplicate" ? 409 : 400 });
    }
    const id = result.createdRows[0].subjectId;
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return subjectErrorResponse(err, "[college/subjects POST]");
  }
}
