export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { draftDocId, resolveCurrentSemester, resolveRequestedSemester } from "@/lib/college/semester";
import type { CourseYearTiming } from "@/types";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { timingLookupFrom } from "@/lib/timetable/facultyOverlap";
import { makeLiveSlotPredicate } from "@/lib/timetable/liveSlots";
import { publishSectionDraft } from "@/lib/timetable/publishDraft";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

// Materialises a draft into `timetableSlots` - the moment it becomes visible to
// the Principal, Vice Principal, faculty (panel/teaching) and the Class Leader.
//
// Replaces only this section's GENERATED slots. Manual/pinned slots survive,
// because the HOD placed those deliberately and the generator was told to work
// around them.
//
// The publish itself - validation, clash checks and every write - is one
// transaction in lib/timetable/publishDraft.ts; this route only decides WHO may
// publish WHAT.

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await readJsonBody(request)) as { sectionId?: string; semester?: number; effectiveDate?: string };
    const sectionId = body.sectionId;
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    // The "w.e.f" date printed on the timetable - asked for at publish time.
    const effectiveDate = body.effectiveDate?.trim() || undefined;
    if (effectiveDate && (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(effectiveDate)))) {
      return NextResponse.json({ error: "effectiveDate must be a valid date (YYYY-MM-DD)" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const section = sectionSnap.data() as { department: string; courseId: string; year: number };

    // Every course-year's own timing, so both this section's own current
    // semester AND every OTHER slot's own course-year semester (for the
    // conflict re-check) resolve against the calendar that actually
    // governs each of them - two different courses can be in different
    // semesters (or none) at once, see loadContext.ts's own version of this.
    const allTimingsSnap = await collegeRef.collection("courseYearTimings").get();
    const allTimings = allTimingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as CourseYearTiming);
    const ownKey = `${section.courseId}_${section.year}`;
    // Which semester to publish - explicitly whichever one the Timetable
    // editor was actually working in (see draft/route.ts's own override),
    // not re-derived from today's date independently. Re-deriving here was a
    // real bug risk: if the HOD had deliberately opened a semester other than
    // whichever one today's date resolves to, publish would silently act on
    // a DIFFERENT semester's draft (or find none at all) instead of the one
    // just edited. Omitted body.semester falls back to today's date exactly
    // as before this override existed.
    let currentSemester: number | null =
      resolveCurrentSemester(allTimings.find((t) => `${t.courseId}_${t.year}` === ownKey) ?? null);
    if (body.semester != null) {
      const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, body.semester);
      if (!semesterResult.ok) {
        return NextResponse.json({ error: semesterResult.error }, { status: 400 });
      }
      currentSemester = semesterResult.semester;
    }

    // Only the section's own department - or an HOD who owns/manages it (a
    // parent HOD over a sub-department, or a Sub-HOD's grouped/managed
    // branch) - may actually publish. An HOD only lending faculty to an
    // unrelated department (see faculty-assignment-requests) has no editable
    // scope over that section at all, so this always 403s for them - the
    // Timetable page correctly routes them to "Notify department" instead,
    // and this is the server-side backstop for that, not just a UI hint.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, section.department)) {
        return NextResponse.json(
          { error: "This section isn't in your department - notify its own HOD instead of publishing it directly." },
          { status: 403 },
        );
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, section.courseId, section.year);
      if (!ok) {
        return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
      }
    }

    // This session - the same Section doc is reused by a new cohort every
    // academic year (see Section.batch's own doc-comment), so every read and
    // write has to agree on which session it's operating in, or a new
    // cohort's publish would silently delete or conflict against the
    // PREVIOUS cohort's own slots for the exact same sectionId/courseId/year.
    const currentAcademicYear = await resolveCollegeAcademicYear(db, session.collegeId);

    // A slot from a DIFFERENT semester of its own course-year, OR a DIFFERENT
    // academic session entirely (a past cohort's now-finished class), is
    // history, not a live conflict - judged against each slot's OWN
    // course-year (exact timings only, as before), with this section's own
    // course-year pinned to the semester being published.
    const isLiveSlot = makeLiveSlotPredicate(timingLookupFrom(allTimings), currentAcademicYear, {
      semesterOverrides: new Map([[ownKey, currentSemester]]),
    });

    const outcome = await publishSectionDraft({
      db,
      collegeId: session.collegeId,
      draftId: draftDocId(sectionId, currentSemester),
      section: { id: sectionId, department: section.department, courseId: section.courseId, year: Number(section.year) },
      semester: currentSemester,
      currentAcademicYear,
      isLiveSlot,
      publishedByName: session.email,
      writer: session.uid,
      effectiveDate,
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error, ...(outcome.issues ? { issues: outcome.issues } : {}) },
        { status: outcome.status },
      );
    }

    await writeAuditLogSafe(db, session.collegeId, {
      action: "TIMETABLE_PUBLISHED",
      performedBy: session.uid,
      performedByName: session.email || session.role,
      targetId: sectionId,
      details: {
        semester: currentSemester, academicYear: currentAcademicYear,
        published: outcome.published, replaced: outcome.replaced, droppedStaleAssignments: outcome.droppedStaleAssignments,
      },
    });

    return NextResponse.json({
      ok: true,
      published: outcome.published,
      replaced: outcome.replaced,
      droppedStaleAssignments: outcome.droppedStaleAssignments,
    });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/publish POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
