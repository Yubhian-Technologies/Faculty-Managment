export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { draftDocId, matchesCurrentSemester, resolveCurrentSemester, resolveRequestedSemester } from "@/lib/college/semester";
import { resolveTimetableAcademicYear, matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import type { CourseYearTiming, TimetableDraft, TimetableSlot } from "@/types";

// Materialises a draft into `timetableSlots` - the moment it becomes visible to
// the Principal, Vice Principal, faculty (panel/teaching) and the Class Leader.
//
// Replaces only this section's GENERATED slots. Manual/pinned slots survive,
// because the HOD placed those deliberately and the generator was told to work
// around them.

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await request.json()) as { sectionId?: string; semester?: number };
    const sectionId = body.sectionId;
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const section = sectionSnap.data() as { department: string; courseId: string; year: number };

    // Every course-year's own timing, so both this section's own current
    // semester AND every OTHER slot's own course-year semester (for the
    // conflict re-check below) resolve against the calendar that actually
    // governs each of them - two different courses can be in different
    // semesters (or none) at once, see loadContext.ts's own version of this.
    const allTimingsSnap = await collegeRef.collection("courseYearTimings").get();
    const allTimings = allTimingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as CourseYearTiming);
    const currentSemesterByCourseYear = new Map<string, number | null>(
      allTimings.map((t) => [`${t.courseId}_${t.year}`, resolveCurrentSemester(t)])
    );
    // Which semester to publish - explicitly whichever one the Timetable
    // editor was actually working in (see draft/route.ts's own override),
    // not re-derived from today's date independently. Re-deriving here was a
    // real bug risk: if the HOD had deliberately opened a semester other than
    // whichever one today's date resolves to, publish would silently act on
    // a DIFFERENT semester's draft (or find none at all) instead of the one
    // just edited. Omitted body.semester falls back to today's date exactly
    // as before this override existed.
    let currentSemester = currentSemesterByCourseYear.get(`${section.courseId}_${section.year}`) ?? null;
    if (body.semester != null) {
      const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, body.semester);
      if (!semesterResult.ok) {
        return NextResponse.json({ error: semesterResult.error }, { status: 400 });
      }
      currentSemester = semesterResult.semester;
      currentSemesterByCourseYear.set(`${section.courseId}_${section.year}`, currentSemester);
    }

    const draftRef = collegeRef.collection("timetableDrafts").doc(draftDocId(sectionId, currentSemester));
    const draftSnap = await draftRef.get();
    if (!draftSnap.exists) return NextResponse.json({ error: "No draft to publish" }, { status: 404 });
    const draft = { id: draftSnap.id, ...draftSnap.data() } as TimetableDraft;
    if (!draft.slots?.length) {
      return NextResponse.json({ error: "This draft has no slots to publish" }, { status: 400 });
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
    // write below has to agree on which session it's operating in, or a new
    // cohort's publish would silently delete or conflict against the
    // PREVIOUS cohort's own slots for the exact same sectionId/courseId/year.
    const sessionSnap = await collegeRef.collection("academicSessions").where("isCurrent", "==", true).limit(1).get();
    const currentAcademicYear = resolveTimetableAcademicYear(
      sessionSnap.empty ? undefined : (sessionSnap.docs[0].data() as { label?: string }).label
    );

    // Re-check faculty double-booking against live data: another section may have
    // published since this draft was generated, so the draft's view of who is
    // free can be stale. A slot from a DIFFERENT semester of its own
    // course-year, OR a DIFFERENT academic session entirely (a past cohort's
    // now-finished class), is history, not a live conflict - excluded up
    // front the same way loadContext.ts scopes busyFaculty for the solver, so
    // a faculty free again once their prior-semester/prior-session class
    // ended isn't wrongly blocked from a new placement at the same day/period.
    const allSlotsSnap = await collegeRef.collection("timetableSlots").get();
    const allSlots = allSlotsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot)
      .filter((s) =>
        matchesCurrentSemester(s.semester, currentSemesterByCourseYear.get(`${s.courseId}_${s.year}`) ?? null) &&
        matchesCurrentAcademicYear(s.academicYear, currentAcademicYear)
      );

    const conflicts: string[] = [];
    for (const s of draft.slots) {
      const clash = allSlots.find(
        (existing) =>
          existing.sectionId !== sectionId &&
          existing.facultyId === s.facultyId &&
          existing.day === s.day &&
          existing.periodNumber === s.periodNumber,
      );
      if (clash) {
        conflicts.push(
          `${s.facultyName} is now booked for another section at ${s.day} period ${s.periodNumber}. Regenerate this timetable.`,
        );
      }
    }
    if (conflicts.length > 0) {
      return NextResponse.json(
        { error: "Conflicts appeared since this draft was generated", issues: [...new Set(conflicts)] },
        { status: 409 },
      );
    }

    // This section's own stale GENERATED slots - already narrowed to
    // "current semester and current session, or untagged/legacy" by the
    // allSlots filter above (this section's own course-year resolves to the
    // same `currentSemester`/`currentAcademicYear` by construction), so this
    // ALSO sweeps up any legacy/untagged slots the first time a section
    // publishes under a newly-configured semester regime or before this
    // field existed, while never touching a genuinely PRIOR semester's or
    // PRIOR session's own tagged slots (those stay as history - see
    // Timetable History). This is what stops a new cohort's first publish
    // from deleting the previous cohort's own timetable for this same
    // section - it couldn't tell them apart before academicYear existed.
    const staleGenerated = allSlots.filter((s) => s.sectionId === sectionId && s.source === "GENERATED");
    const now = FieldValue.serverTimestamp();

    // Chunked to stay clear of Firestore's 500-op batch limit on large sections.
    const ops: (() => Promise<void>)[] = [];
    let batch = db.batch();
    let count = 0;
    const flush = () => {
      const b = batch;
      ops.push(async () => { await b.commit(); });
      batch = db.batch();
      count = 0;
    };

    for (const s of staleGenerated) {
      batch.delete(collegeRef.collection("timetableSlots").doc(s.id));
      if (++count >= 400) flush();
    }

    for (const s of draft.slots) {
      const ref = collegeRef.collection("timetableSlots").doc();
      batch.set(ref, {
        collegeId: session.collegeId,
        department: section.department,
        assignmentId: s.assignmentId,
        facultyId: s.facultyId,
        facultyName: s.facultyName,
        courseId: section.courseId,
        year: Number(section.year),
        sectionId,
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        day: s.day,
        periodNumber: s.periodNumber,
        source: "GENERATED",
        isPinned: false,
        semester: currentSemester,
        academicYear: currentAcademicYear,
        createdAt: now,
        updatedAt: now,
      });
      if (++count >= 400) flush();
    }

    batch.update(draftRef, {
      status: "PUBLISHED",
      semester: currentSemester,
      academicYear: currentAcademicYear,
      publishedAt: now,
      publishedByName: session.email,
    });
    flush();

    for (const run of ops) await run();

    return NextResponse.json({
      ok: true,
      published: draft.slots.length,
      replaced: staleGenerated.length,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/publish POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
