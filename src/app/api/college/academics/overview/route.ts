export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { computeAcademicsHealth } from "@/lib/subjects/health";
import type { CourseCatalogItem } from "@/types";

// Academics dashboard.
//   GET            -> { activeCourses }: two count() aggregates, no documents read.
//   GET ?check=1   -> { issues }: the data-health check. Reads the catalog, courses, timings, subjects and
//                     semester assignments (id/field-masked), so it runs only when asked for.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const college = getAdminDb().collection("colleges").doc(session.collegeId);

    if (new URL(request.url).searchParams.get("check") !== "1") {
      const [all, inactive] = await Promise.all([
        college.collection("courses").count().get(),
        college.collection("courses").where("isActive", "==", false).count().get(),
      ]);
      return NextResponse.json({ activeCourses: all.data().count - inactive.data().count });
    }

    const [catalogSnap, coursesSnap, deptsSnap, timingsSnap, subjectsSnap, instancesSnap] = await Promise.all([
      college.collection("courseCatalog").get(),
      college.collection("courses").get(),
      college.collection("departments").select("name").get(),
      college.collection("courseYearTimings").select("courseId", "year", "semesters").get(),
      college.collection("subjects").select("code", "name", "courseId", "catalogId", "regulation", "isActive").get(),
      college.collection("subjectSemesterAssignments").select("subjectId", "subjectCode", "subjectName", "regulation", "isActive").get(),
    ]);
    const deptName = new Map(deptsSnap.docs.map((d) => [d.id, String(d.get("name") ?? "")]));
    const yearsWithSemesters = new Map<string, Set<number>>();
    for (const t of timingsSnap.docs) {
      const courseId = String(t.get("courseId") ?? "");
      const year = Number(t.get("year"));
      const semesters = t.get("semesters");
      if (!courseId || !Number.isInteger(year) || !Array.isArray(semesters) || semesters.length === 0) continue;
      yearsWithSemesters.set(courseId, (yearsWithSemesters.get(courseId) ?? new Set()).add(year));
    }
    const issues = computeAcademicsHealth({
      catalog: catalogSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CourseCatalogItem, "id">) })),
      courses: coursesSnap.docs.map((d) => {
        const c = d.data() as { name: string; departmentId?: string; catalogId?: string; durationYears?: number; isActive?: boolean };
        return { id: d.id, name: c.name, departmentName: c.departmentId ? deptName.get(c.departmentId) : undefined, catalogId: c.catalogId, durationYears: c.durationYears, isActive: c.isActive };
      }),
      yearsWithSemesters,
      subjects: subjectsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })),
      instances: instancesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { subjectId: string }) })),
    });
    return NextResponse.json({ issues, checkedAt: new Date().toISOString() });
  } catch (err) {
    return subjectErrorResponse(err, "[academics/overview]");
  }
}
