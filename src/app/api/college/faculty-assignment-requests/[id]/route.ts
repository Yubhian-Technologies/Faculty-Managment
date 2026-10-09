export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { getHodDepartmentScope, canHodEditDepartment, facultyManageableDepartmentNames } from "@/lib/departments/scope";
import { isTimetableInchargeForDepartment } from "@/lib/departments/timetableIncharge";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { isFacultyAvailable } from "@/types";
import { allocationFields, facultyNamesText, requestAllocations } from "@/lib/teaching/requestAllocations";
import { matchesCurrentSemester, resolveCurrentSemester, loadEffectiveTiming } from "@/lib/college/semester";
import {
  expandDeclaredBusy, loadUserRole, notifyLendRecipients, requesterRequestsLink, requesterTimetableLink,
} from "@/lib/timetable/declaredBusy";
import type { DayOfWeek, FacultyAssignmentRequest, TimetableDraft, TimetableSlot } from "@/types";

const VALID_DAYS = new Set<DayOfWeek>(["MON", "TUE", "WED", "THU", "FRI", "SAT"]);

// Fulfills (allocate) or declines an incoming faculty-assignment request -
// the target department's HOD (or someone who edits that department, e.g.
// its own parent HOD), or a Timetable Incharge for ANY course-year in that
// department (see TimetableIncharge in src/types/core.ts - fulfilling isn't
// tied to one specific course-year, it's "does this department have anyone
// free"), may act on it. Allocating creates the actual TeachingAssignment
// record directly, filed under the *requesting* section's own department
// (matching how a normal direct assignment is filed). The lending side never
// places periods on the requester's timetable themselves - they only declare
// (via set_busy_periods) when the allocated faculty is already busy with
// their own department's classes; the requester places the subject on their
// own Timetable page via the usual "Add a subject" flow, which is blocked
// from those declared-busy cells the same way a real double-booking is (see
// busyPeriods merging into busyFaculty in src/lib/timetable/loadContext.ts).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("HOD", "PANEL_MEMBER", "COLLEGE_STAFF");
    const { id } = await params;
    const body = (await readJsonBody(request)) as {
      action?: "allocate" | "reallocate" | "decline" | "notify_timetable_updated" | "set_busy_periods" | "reopen_busy_periods";
      facultyId?: string;
      fromFacultyId?: string;
      facultyName?: string;
      declineReason?: string;
      busyPeriods?: { day?: string; period?: number; year?: number }[];
    };

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const reqRef = collegeRef.collection("facultyAssignmentRequests").doc(id);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    const reqData = reqSnap.data() as FacultyAssignmentRequest;

    // Full scope (not narrowed to "Working as"): a request sent to any department
    // this HOD heads may be acted on from any of them.
    const scope = session.role === "HOD" ? await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: false }) : null;
    if (scope) {
      // Own department/sub-departments only, not managed branches (see
      // ownDepartmentNames doc) - matches the GET route's incoming-list
      // filter, so a request that isn't listed here can't be acted on either.
      // Names the request's actual target department in the error - the most
      // common cause is the "Working As" switcher having moved to a
      // different department since the (now-stale) request list was loaded,
      // not a real permissions gap, and that's invisible without saying so.
      if (!facultyManageableDepartmentNames(scope).includes(reqData.targetDepartmentName)) {
        return NextResponse.json(
          { error: `This request was sent to ${reqData.targetDepartmentName}, not ${scope.departmentName || "your department"} - switch "Working As" and reload if you meant to act on it` },
          { status: 403 },
        );
      }
    } else {
      const ok = await isTimetableInchargeForDepartment(db, session.collegeId, session.uid, reqData.targetDepartmentName);
      if (!ok) {
        return NextResponse.json({ error: `This request was sent to ${reqData.targetDepartmentName}, not a department you're Timetable Incharge for` }, { status: 403 });
      }
    }

    const now = new Date();

    // The lending side's declaration of when the allocated faculty is
    // already busy (their own department's classes), expressed in the
    // REQUESTING section's own period numbering - see the doc-comment on
    // FacultyAssignmentRequest.busyPeriods. Always a full replace (same
    // convention as course-year-timings' semesters list), so removing an
    // entry client-side is just resubmitting the trimmed array.
    if (body.action === "set_busy_periods") {
      if (reqData.status !== "ALLOCATED") {
        return NextResponse.json({ error: "This request hasn't been allocated yet" }, { status: 409 });
      }
      // Busy periods belong to ONE allocated faculty (a request can have several);
      // without a facultyId it is the first, as it was when only one was possible.
      const allAllocations = requestAllocations(reqData);
      const targetIndex = body.facultyId ? allAllocations.findIndex((a) => a.facultyId === body.facultyId) : 0;
      if (targetIndex < 0) {
        return NextResponse.json({ error: "That faculty is not allocated to this request" }, { status: 404 });
      }
      const target = allAllocations[targetIndex];
      // Closed = view-only until the lending side clicks Edit (reopen below).
      if (reqData.busyClosed) {
        return NextResponse.json({ error: "Busy periods are closed - click Edit to change them" }, { status: 409 });
      }
      const raw = body.busyPeriods ?? [];
      if (raw.length > 100) {
        return NextResponse.json({ error: "Too many busy periods" }, { status: 400 });
      }
      const busyPeriods: { day: DayOfWeek; period: number; year?: number }[] = [];
      for (const bp of raw) {
        if (!bp.day || !VALID_DAYS.has(bp.day as DayOfWeek)) {
          return NextResponse.json({ error: `Invalid day: ${bp.day}` }, { status: 400 });
        }
        if (!Number.isInteger(bp.period) || (bp.period as number) < 1) {
          return NextResponse.json({ error: "Each period must be a positive number" }, { status: 400 });
        }
        if (bp.year != null && (!Number.isInteger(bp.year) || bp.year < 1 || bp.year > 10)) {
          return NextResponse.json({ error: `Invalid year: ${bp.year}` }, { status: 400 });
        }
        busyPeriods.push({
          day: bp.day as DayOfWeek, period: bp.period as number, ...(bp.year != null ? { year: bp.year } : {}),
        });
      }
      // De-dupe by day+period+year - a re-added entry shouldn't double up, but
      // the same period number in two different years is two different hours.
      const busyKey = (bp: { day: string; period: number; year?: number }) => `${bp.day}:${bp.period}:${bp.year ?? ""}`;
      const deduped = Array.from(new Map(busyPeriods.map((bp) => [busyKey(bp), bp])).values());
      const previousKeys = new Set((target.busyPeriods ?? []).map(busyKey));
      const added = deduped.filter((bp) => !previousKeys.has(busyKey(bp)));
      const nextAllocations = allAllocations.map((a, i) => (i === targetIndex ? { ...a, busyPeriods: deduped } : a));
      await reqRef.update({ ...allocationFields(nextAllocations), updatedAt: now });

      // Newly busy cells never re-validate what the requester already placed -
      // surface any that now clash with their draft or live timetable, so they
      // aren't left with a placement that silently breaks the lender's
      // declaration (publish would reject it much later).
      const conflicts: string[] = [];
      if (added.length > 0 && target.facultyId) {
        const timingSnaps = await Promise.all(
          Array.from(new Set([Number(reqData.year), ...added.map((bp) => bp.year).filter((y): y is number => y != null)])).map(async (y) => {
            return [y, await loadEffectiveTiming(db, session.collegeId, reqData.courseId, y)] as const;
          }),
        );
        const timings = new Map(timingSnaps);
        const sectionTiming = timings.get(Number(reqData.year)) ?? null;
        const newCells = expandDeclaredBusy(added, Number(reqData.year), sectionTiming, (y) => timings.get(y) ?? null);
        const currentSemester = resolveCurrentSemester(sectionTiming);
        const hit = new Set<string>();

        const [slotsSnap, draftsSnap] = await Promise.all([
          collegeRef.collection("timetableSlots").where("sectionId", "==", reqData.sectionId).get(),
          collegeRef.collection("timetableDrafts").where("sectionId", "==", reqData.sectionId).get(),
        ]);
        for (const d of slotsSnap.docs) {
          const sl = d.data() as TimetableSlot;
          if (sl.facultyId !== target.facultyId || !matchesCurrentSemester(sl.semester, currentSemester)) continue;
          if (newCells.has(`${sl.day}:${sl.periodNumber}`)) hit.add(`${sl.day}:${sl.periodNumber}`);
        }
        for (const d of draftsSnap.docs) {
          const draft = d.data() as TimetableDraft;
          if (!matchesCurrentSemester(draft.semester ?? null, currentSemester)) continue;
          for (const sl of draft.slots ?? []) {
            if (sl.facultyId !== target.facultyId) continue;
            if (newCells.has(`${sl.day}:${sl.periodNumber}`)) hit.add(`${sl.day}:${sl.periodNumber}`);
          }
        }
        for (const cell of hit) {
          const [day, period] = cell.split(":");
          conflicts.push(`${day} P${period}`);
        }
        if (conflicts.length > 0) {
          const role = await loadUserRole(db, session.collegeId, reqData.requestedBy);
          await notify(
            db, session.collegeId, reqData.requestedBy, "FACULTY_ASSIGNMENT_ALLOCATED",
            "Busy period clashes with your timetable",
            `${reqData.targetDepartmentName} marked ${target.facultyName || "the allocated faculty"} busy at ${conflicts.join(", ")}, where ${reqData.subjectName} (Section ${reqData.sectionName}) is already placed - move it before publishing`,
            requesterTimetableLink(role, reqData),
          );
        }
      }
      return NextResponse.json({ ok: true, busyPeriods: deduped, conflicts });
    }

    // Edit after close: reopens the busy-periods step so the lender can change
    // what they declared, then Notify & close again. Nothing is notified here.
    if (body.action === "reopen_busy_periods") {
      if (reqData.status !== "ALLOCATED") {
        return NextResponse.json({ error: "This request hasn't been allocated yet" }, { status: 409 });
      }
      await reqRef.update({ busyClosed: false, updatedAt: now });
      return NextResponse.json({ ok: true });
    }

    // Fired once the lending side considers this lend "ready" - whether or
    // not they declared any busy periods (none can legitimately mean "fully
    // free") - so the requesting department knows they can go place the
    // subject on their own Timetable page.
    if (body.action === "notify_timetable_updated") {
      if (reqData.status !== "ALLOCATED") {
        return NextResponse.json({ error: "This request hasn't been allocated yet" }, { status: 409 });
      }
      // A second close (after an Edit) tells the requester the periods changed.
      // ONE close covers every faculty allocated to this request, and is the
      // moment the requester is allowed to place any of them.
      const isUpdate = reqData.busyClosedAt != null;
      const names = facultyNamesText(requestAllocations(reqData));
      await reqRef.update({ busyClosed: true, busyClosedAt: now, updatedAt: now });
      await notifyLendRecipients(
        db, session.collegeId, reqData, "FACULTY_ASSIGNMENT_ALLOCATED",
        isUpdate ? "Busy periods updated" : "Ready to schedule",
        isUpdate
          ? `${reqData.targetDepartmentName} updated the busy periods of ${names} for ${reqData.subjectName} (Section ${reqData.sectionName}) - check your Timetable page`
          : `${reqData.targetDepartmentName} shared the busy periods of ${names} for ${reqData.subjectName} (Section ${reqData.sectionName}) - you can now place it on your Timetable page`,
      );
      return NextResponse.json({ ok: true });
    }

    // A request takes its FIRST faculty while PENDING; further faculty can be added
    // while it is ALLOCATED and the lender hasn't closed it (Notify & close, or Edit
    // to reopen). "decline" is only for a request nobody has been allocated to yet.
    const addingAnother = body.action === "allocate" && reqData.status === "ALLOCATED";
    if (addingAnother && reqData.busyClosed) {
      return NextResponse.json({ error: "This request is closed - click Edit to add another faculty" }, { status: 409 });
    }
    if (body.action === "reallocate") {
      if (reqData.status !== "ALLOCATED" || requestAllocations(reqData).length === 0) {
        return NextResponse.json({ error: "Only an allocated request can change its faculty member" }, { status: 409 });
      }
    } else if (reqData.status !== "PENDING" && !addingAnother) {
      return NextResponse.json({ error: "This request has already been handled" }, { status: 409 });
    }

    const requesterRole = await loadUserRole(db, session.collegeId, reqData.requestedBy);
    if (body.action === "decline") {
      await reqRef.update({ status: "DECLINED", declineReason: body.declineReason ?? "", updatedAt: now });
      await notify(
        db, session.collegeId, reqData.requestedBy, "FACULTY_ASSIGNMENT_DECLINED",
        "Faculty assignment request declined",
        `${reqData.targetDepartmentName} couldn't lend a faculty member for ${reqData.subjectName} (Section ${reqData.sectionName})`,
        requesterRequestsLink(requesterRole)
      );
      return NextResponse.json({ ok: true });
    }

    if ((body.action !== "allocate" && body.action !== "reallocate") || !body.facultyId) {
      return NextResponse.json({ error: "action and facultyId are required" }, { status: 400 });
    }

    const facultySnap = await collegeRef.collection("facultyMembers").doc(body.facultyId).get();
    if (!facultySnap.exists) return NextResponse.json({ error: "Faculty not found" }, { status: 404 });
    const faculty = facultySnap.data() as { legalName?: string; department?: string; status?: string };
    const allocatedName = facultyDisplayName(faculty);
    // Defense-in-depth: the lending department's own picker already filters
    // to available faculty, but facultyId is still trusted input here.
    if (!isFacultyAvailable(faculty.status)) {
      return NextResponse.json({ error: "That faculty member is not currently available for teaching assignments" }, { status: 409 });
    }
    // An Incharge (no HOD scope tree) may only offer up faculty from the
    // exact department the request targeted - an HOD may also reach into a
    // sub-department's own faculty, same as before.
    // The Incharge's own picker (faculty GET, includeParent) also offers the
    // target department's PARENT roster - a sub-department's faculty mostly
    // sit there - so allocation accepts the same set, like the Sub-HOD can.
    let inchargeDepartments = [reqData.targetDepartmentName];
    if (!scope) {
      const deptSnap = await collegeRef.collection("departments").where("name", "==", reqData.targetDepartmentName).limit(1).get();
      const parentId = (deptSnap.docs[0]?.data() as { parentDepartmentId?: string } | undefined)?.parentDepartmentId;
      if (parentId) {
        const parentName = (await collegeRef.collection("departments").doc(parentId).get()).data()?.name as string | undefined;
        if (parentName) inchargeDepartments = [...inchargeDepartments, parentName];
      }
    }
    const facultyInScope = scope
      ? canHodEditDepartment(scope, faculty.department ?? "")
      : inchargeDepartments.includes(faculty.department ?? "");
    if (!facultyInScope) {
      return NextResponse.json({ error: "That faculty member isn't in your department" }, { status: 403 });
    }

    const courseSnap = await collegeRef.collection("courses").doc(reqData.courseId).get();
    const course = courseSnap.data() as { departmentId?: string } | undefined;

    if (requestAllocations(reqData).some((a) => a.facultyId === body.facultyId)) {
      return NextResponse.json({ error: "This faculty is already allocated to this request" }, { status: 409 });
    }

    const existing = await collegeRef.collection("teachingAssignments")
      .where("facultyId", "==", body.facultyId)
      .where("sectionId", "==", reqData.sectionId)
      .where("subjectId", "==", reqData.subjectId)
      .get();
    if (existing.docs.some((d) => !(d.data() as { isPast?: boolean }).isPast)) {
      return NextResponse.json({ error: "This faculty is already assigned to this subject for this section" }, { status: 409 });
    }

    if (body.action === "reallocate") {
      // Changes one faculty member already on the request. Their teaching
      // assignment and its timetable slots are pointed at the new faculty member,
      // and only that entry in `allocations` changes. Refuses if the new faculty
      // member already has a class in one of those periods.
      const allocs = requestAllocations(reqData);
      const old = allocs.find((a) => a.facultyId === body.fromFacultyId);
      if (!old || !old.teachingAssignmentId) {
        return NextResponse.json({ error: "That faculty member isn't allocated to this request" }, { status: 404 });
      }
      if (allocs.some((a) => a.facultyId === body.facultyId)) {
        return NextResponse.json({ error: "That faculty member is already allocated to this request" }, { status: 409 });
      }
      const taRefExisting = collegeRef.collection("teachingAssignments").doc(old.teachingAssignmentId);
      const slotSnaps = await collegeRef.collection("timetableSlots").where("assignmentId", "==", old.teachingAssignmentId).get();
      const newFacultySlots = await collegeRef.collection("timetableSlots").where("facultyId", "==", body.facultyId).get();
      const busyKeys = new Set(
        newFacultySlots.docs
          .filter((d) => d.data().assignmentId !== old.teachingAssignmentId)
          .map((d) => { const s = d.data() as { day: string; periodNumber: number; year?: number }; return `${s.day}|${s.periodNumber}|${s.year ?? ""}`; })
      );
      const clash = slotSnaps.docs.find((d) => {
        const s = d.data() as { day: string; periodNumber: number; year?: number };
        return busyKeys.has(`${s.day}|${s.periodNumber}|${s.year ?? ""}`);
      });
      if (clash) {
        return NextResponse.json({ error: "That faculty member already has a class in one of this subject's periods" }, { status: 409 });
      }
      const newName = allocatedName || body.facultyName || "";
      // The busy periods declared for the replaced faculty member don't carry
      // over - the new one has to declare their own.
      const nextAllocations = allocs.map((a) =>
        a.facultyId === body.fromFacultyId
          ? { ...a, facultyId: body.facultyId as string, facultyName: newName, busyPeriods: [], allocatedBy: session.uid }
          : a
      );
      const batch = db.batch();
      // The teaching assignment can be gone already (deleted on its own); then the
      // new faculty member gets a fresh one for this section and subject, the same
      // as Allocate, and the slots move onto it.
      const taSnap = await taRefExisting.get();
      let teachingAssignmentId = old.teachingAssignmentId;
      if (taSnap.exists) {
        batch.update(taRefExisting, { facultyId: body.facultyId, facultyName: newName, updatedAt: now });
      } else {
        const freshRef = collegeRef.collection("teachingAssignments").doc();
        teachingAssignmentId = freshRef.id;
        batch.set(freshRef, {
          collegeId: session.collegeId,
          facultyId: body.facultyId,
          facultyName: newName,
          department: reqData.requestingDepartment,
          departmentId: course?.departmentId ?? "",
          courseId: reqData.courseId,
          courseName: reqData.courseName,
          year: reqData.year,
          sectionId: reqData.sectionId,
          sectionName: reqData.sectionName,
          subjectId: reqData.subjectId,
          subjectName: reqData.subjectName,
          subjectCode: reqData.subjectCode,
          hoursPerWeek: reqData.hoursPerWeek,
          assignedBy: session.uid,
          assignedByName: session.role,
          createdAt: now,
          updatedAt: now,
          assignmentAcademicYear: "",
          assignmentSemester: "",
        });
      }
      for (const s of slotSnaps.docs) {
        batch.update(s.ref, {
          facultyId: body.facultyId, facultyName: newName, updatedAt: now,
          ...(taSnap.exists ? {} : { assignmentId: teachingAssignmentId }),
        });
      }
      batch.update(reqRef, { ...allocationFields(nextAllocations.map((a) => a.facultyId === body.facultyId ? { ...a, teachingAssignmentId } : a)), updatedAt: now });
      await batch.commit();
      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "FACULTY_ASSIGNMENT_REALLOCATED",
        performedBy: session.uid,
        performedByName: session.role,
        targetId: id,
        details: { subjectName: reqData.subjectName, sectionName: reqData.sectionName, replacedFacultyId: body.fromFacultyId, facultyName: newName },
        timestamp: now,
      });
      await notify(
        db, session.collegeId, reqData.requestedBy, "FACULTY_ASSIGNMENT_ALLOCATED",
        "Faculty for your requested subject changed",
        `${reqData.targetDepartmentName} changed the faculty member for ${reqData.subjectName} (Section ${reqData.sectionName}) to ${newName || "a new faculty member"}`,
        requesterRequestsLink(requesterRole)
      );
      return NextResponse.json({ ok: true, teachingAssignmentId });
    }

    const taRef = collegeRef.collection("teachingAssignments").doc();
    await taRef.set({
      collegeId: session.collegeId,
      facultyId: body.facultyId,
      facultyName: allocatedName || body.facultyName || "",
      department: reqData.requestingDepartment,
      departmentId: course?.departmentId ?? "",
      courseId: reqData.courseId,
      courseName: reqData.courseName,
      year: reqData.year,
      sectionId: reqData.sectionId,
      sectionName: reqData.sectionName,
      subjectId: reqData.subjectId,
      subjectName: reqData.subjectName,
      subjectCode: reqData.subjectCode,
      hoursPerWeek: reqData.hoursPerWeek,
      assignedBy: session.uid,
      assignedByName: session.role,
      createdAt: now,
      updatedAt: now,
      assignmentAcademicYear: "",
      assignmentSemester: "",
    });

    const allocatedAs = allocatedName || body.facultyName || "";
    const nextAllocations = [
      ...requestAllocations(reqData),
      { facultyId: body.facultyId, facultyName: allocatedAs, teachingAssignmentId: taRef.id, busyPeriods: [], allocatedBy: session.uid },
    ];
    await reqRef.update({
      status: "ALLOCATED",
      allocatedBy: reqData.allocatedBy ?? session.uid,
      ...allocationFields(nextAllocations),
      updatedAt: now,
    });

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FACULTY_ASSIGNMENT_ALLOCATED",
      performedBy: session.uid,
      performedByName: session.role,
      targetId: id,
      details: { subjectName: reqData.subjectName, sectionName: reqData.sectionName, facultyName: allocatedName },
      timestamp: now,
    });

    await notify(
      db, session.collegeId, reqData.requestedBy, "FACULTY_ASSIGNMENT_ALLOCATED",
      "Faculty allocated - waiting for the department to close",
      `${reqData.targetDepartmentName} allocated ${allocatedName || "a faculty member"} to ${reqData.subjectName} (Section ${reqData.sectionName}). You can place it on your Timetable page once they share the busy periods and notify you`,
      requesterRequestsLink(requesterRole)
    );

    return NextResponse.json({ ok: true, teachingAssignmentId: taRef.id, allocatedCount: nextAllocations.length });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-assignment-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
