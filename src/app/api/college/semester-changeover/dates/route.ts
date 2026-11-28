export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { actorName } from "@/lib/fees/http";
import { planChangeover, semesterLabel, type SemesterRange } from "@/lib/college/semesterDates";
import type { Course, CourseYearTiming, Department } from "@/types";

// Semester Changeover > Class-Work End Date (Principal / College Office; VP and Academics may look).
// GET                      -> the college's programmes (catalog courses) with the years that have timings.
// GET ?catalogId=&year=    -> every department's course-year of that programme + year, with its semester dates.
// POST { catalogId, year, semester, classWorkEnd, nextStart, nextEnd, courseIds }
//   -> Semester N's class work ends on `classWorkEnd` and Semester N+1 runs nextStart..nextEnd, for every ticked
//      department's course-year, in one batch. Each is checked first (lib/college/semesterDates.ts); nothing is
//      written when any ticked one would not hold together. The date switch does the rest: from the next day the
//      timetable, Mark Attendance, teaching load and dashboards follow Semester N+1 (lib/college/semester.ts).

const unauthorized = () => NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
const failed = () => NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
const iso = (v: unknown) => {
  const t = v as { toDate?: () => Date } | undefined;
  const d = t?.toDate ? t.toDate() : v instanceof Date ? v : null;
  return d ? d.toISOString().slice(0, 10) : "";
};
const rangesOf = (t: Pick<CourseYearTiming, "semesters"> | undefined): SemesterRange[] =>
  (t?.semesters ?? []).map((s) => ({ semester: s.semester, start: iso(s.startDate), end: iso(s.endDate) })).filter((s) => s.start && s.end);

async function load(db: FirebaseFirestore.Firestore, collegeId: string) {
  const college = db.collection("colleges").doc(collegeId);
  const [courses, depts, timings] = await Promise.all([college.collection("courses").get(), college.collection("departments").get(), college.collection("courseYearTimings").get()]);
  const deptName = new Map(depts.docs.map((d) => [d.id, String((d.data() as Department).name ?? "")]));
  const courseRows = courses.docs.map((d) => ({ ...(d.data() as Course), id: d.id }));
  return { courseRows, deptName, timings: timings.docs.map((d) => ({ ...(d.data() as CourseYearTiming), id: d.id })) };
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE", "ACADEMICS");
    const db = getAdminDb();
    const sp = new URL(request.url).searchParams;
    const catalogId = sp.get("catalogId") ?? "";
    const year = Number(sp.get("year"));
    const { courseRows, deptName, timings } = await load(db, session.collegeId);
    if (!catalogId) {
      const programmes = new Map<string, { catalogId: string; name: string; years: Set<number> }>();
      for (const c of courseRows) {
        if (!c.catalogId) continue;
        const p = programmes.get(c.catalogId) ?? { catalogId: c.catalogId, name: c.name ?? "", years: new Set<number>() };
        for (const t of timings) if (t.courseId === c.id && (t.semesters?.length ?? 0) > 0) p.years.add(Number(t.year));
        programmes.set(c.catalogId, p);
      }
      return NextResponse.json({ programmes: [...programmes.values()].filter((p) => p.years.size).map((p) => ({ ...p, years: [...p.years].sort() })).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    const ids = new Set(courseRows.filter((c) => c.catalogId === catalogId).map((c) => c.id));
    const rows = timings.filter((t) => ids.has(t.courseId) && Number(t.year) === year).map((t) => ({
      courseId: t.courseId, timingId: t.id, department: deptName.get(t.departmentId) ?? courseRows.find((c) => c.id === t.courseId)?.departmentId ?? "",
      semesters: rangesOf(t),
    })).sort((a, b) => a.department.localeCompare(b.department));
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return unauthorized();
    console.error("[college/semester-changeover/dates GET]", err);
    return failed();
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const body = (await readJsonBody(request)) as { catalogId?: unknown; year?: unknown; semester?: unknown; classWorkEnd?: unknown; nextStart?: unknown; nextEnd?: unknown; courseIds?: unknown };
    const catalogId = String(body.catalogId ?? "");
    const year = Number(body.year);
    const semester = Number(body.semester);
    const courseIds = Array.isArray(body.courseIds) ? body.courseIds.map(String) : [];
    if (!catalogId || !Number.isInteger(year) || year < 1) return NextResponse.json({ error: "Select the programme and the year." }, { status: 400 });
    if (!Number.isInteger(semester) || semester < 1) return NextResponse.json({ error: "Select the semester whose class work ends." }, { status: 400 });
    if (courseIds.length === 0) return NextResponse.json({ error: "Tick at least one department." }, { status: 400 });
    const dates = { semester, classWorkEnd: String(body.classWorkEnd ?? ""), nextStart: String(body.nextStart ?? ""), nextEnd: String(body.nextEnd ?? "") };

    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const { courseRows, deptName, timings } = await load(db, session.collegeId);
    const own = new Set(courseRows.filter((c) => c.catalogId === catalogId).map((c) => c.id));

    // Same academic-year bound the Semester Timings form enforces, when the current session has its dates.
    const cur = (await college.collection("academicSessions").where("isCurrent", "==", true).limit(1).get()).docs[0]?.data() as { label?: string; startDate?: string; endDate?: string } | undefined;

    const plans: { ref: FirebaseFirestore.DocumentReference; department: string; semesters: SemesterRange[] }[] = [];
    const problems: string[] = [];
    for (const courseId of courseIds) {
      const t = timings.find((x) => x.courseId === courseId && Number(x.year) === year);
      const department = t ? deptName.get(t.departmentId) ?? "" : "";
      if (!t || !own.has(courseId)) { problems.push(`${department || courseId}: this course-year has no timings for Year ${year}.`); continue; }
      const plan = planChangeover(rangesOf(t), dates);
      if (!plan.ok) { problems.push(`${department}: ${plan.error}`); continue; }
      if (cur?.startDate && cur?.endDate) {
        const out = plan.semesters.find((s) => s.start < cur.startDate! || s.end > cur.endDate!);
        if (out) { problems.push(`${department}: Semester ${out.semester} must fall within the ${cur.label ?? "current"} academic year (${cur.startDate} to ${cur.endDate}).`); continue; }
      }
      plans.push({ ref: college.collection("courseYearTimings").doc(t.id), department, semesters: plan.semesters });
    }
    if (problems.length) return NextResponse.json({ error: problems[0], problems }, { status: 400 });

    const now = new Date();
    const batch = db.batch();
    for (const p of plans) {
      batch.update(p.ref, {
        // Stored like the Semester Timings form does: "YYYY-MM-DD" as a Date at UTC midnight.
        semesters: p.semesters.map((s) => ({ semester: s.semester, startDate: new Date(`${s.start}T00:00:00Z`), endDate: new Date(`${s.end}T00:00:00Z`) })),
        updatedAt: now,
      });
    }
    await batch.commit();
    await writeAuditLogSafe(db, session.collegeId, {
      action: "SEMESTER_DATES_SET", performedBy: session.uid, performedByName: await actorName(db, session), targetId: `${catalogId}__y${year}`,
      details: { semester: `${semester} (${semesterLabel(semester)})`, classWorkEnd: dates.classWorkEnd, next: `${dates.nextStart} to ${dates.nextEnd}`, departments: plans.map((p) => p.department) },
    });
    return NextResponse.json({ updated: plans.map((p) => p.department) });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return unauthorized();
    console.error("[college/semester-changeover/dates POST]", err);
    return failed();
  }
}
