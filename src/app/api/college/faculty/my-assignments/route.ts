export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import type { Section, TeachingAssignment } from "@/types";

// Which delegated duties the caller actually holds, in ONE round trip, so the
// sidebar can show the tabs that only make sense for an assigned person
// (Timetable Incharge, Question Bank, section Students / Lab Batches) instead of
// listing them for every faculty member. Each check is a single-document
// existence query (limit 1) and they run in parallel, so the cost is a handful
// of index reads however large the college is. Navigation only - the pages'
// own APIs still enforce who may see or change data.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "COLLEGE_STAFF", "HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const memberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    const ids = memberId === session.uid ? [session.uid] : [session.uid, memberId];

    const [incharge, section, teaches, inBank] = await Promise.all([
      college.collection("timetableIncharges").where("uid", "==", session.uid).limit(1).get(),
      // Section.facultyInchargeUid holds the login uid or, in older data, the faculty record id.
      college.collection("sections").where("facultyInchargeUid", "in", ids).limit(1).get(),
      college.collection("teachingAssignments").where("facultyId", "==", memberId).get(),
      college.collection("midQuestionBanks").where("viewerFacultyIds", "array-contains", memberId).limit(1).get(),
    ]);

    // What the faculty member teaches now: course + year pairs and subjects.
    const current = teaches.docs.map((d) => d.data() as TeachingAssignment).filter((t) => !t.isPast);
    const sectionIds = [...new Set(current.filter((t) => t.sectionId && (!t.courseId || t.year == null)).map((t) => t.sectionId!))];
    const secs = sectionIds.length ? await db.getAll(...sectionIds.map((id) => college.collection("sections").doc(id))) : [];
    const secById = new Map(secs.filter((x) => x.exists).map((x) => [x.id, x.data() as Section]));
    const pairs = new Set(current.map((t) => {
      const sec = t.sectionId ? secById.get(t.sectionId) : undefined;
      const courseId = t.courseId ?? sec?.courseId, year = t.year ?? (sec ? Number(sec.year) : undefined);
      return courseId && year != null ? `${courseId}|${year}` : "";
    }).filter(Boolean));
    const courseIds = [...new Set([...pairs].map((p) => p.split("|")[0]))].slice(0, 30);
    const subjectIds = [...new Set(current.map((t) => t.subjectId).filter(Boolean))].slice(0, 30);

    // Question Bank: once the Exam Cell has published a deadline for a course + year they teach
    // (or a colleague's bank covers them). Internal Exam: once the Exam Cell has configured the
    // marks for a course + year they teach (or put one of their subjects in a marks category).
    const [deadlines, configs, categories] = await Promise.all([
      courseIds.length ? college.collection("midBankDeadlines").where("courseIds", "array-contains-any", courseIds.slice(0, 10)).get() : null,
      courseIds.length ? college.collection("examConfigurations").where("courseId", "in", courseIds).get() : null,
      subjectIds.length ? college.collection("examMarksCategories").where("subjectIds", "array-contains-any", subjectIds.slice(0, 10)).limit(1).get() : null,
    ]);
    const deadlineOpen = (deadlines?.docs ?? []).some((d) => {
      const x = d.data() as { courseIds?: string[]; year?: number };
      return (x.courseIds ?? []).some((c) => pairs.has(`${c}|${x.year}`));
    });
    const configured = (configs?.docs ?? []).some((d) => {
      const x = d.data() as { courseId?: string; year?: number; status?: string };
      return x.status !== "INACTIVE" && pairs.has(`${x.courseId}|${x.year}`);
    }) || Boolean(categories && !categories.empty);

    return NextResponse.json(
      { timetableIncharge: !incharge.empty, sectionIncharge: !section.empty, questionBank: deadlineOpen || !inBank.empty, internalExam: configured },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/my-assignments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
