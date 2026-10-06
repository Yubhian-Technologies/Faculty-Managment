export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadTimetableContext } from "@/lib/timetable/loadContext";
import {
  blockAt, cellKey, checkPlacementAcrossBreak, validatePlacement,
} from "@/lib/timetable/draftPlacement";
import {
  buildSeededDraft, draftFacultyIds, draftRef, inchargeOwnDepartmentNames, isCrossDepartmentLender, loadDraft,
} from "@/lib/timetable/draftAccess";
import { getHodDepartmentScope, canHodEditDepartment, ownDepartmentNames } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { resolveRequestedSemester, draftDocId } from "@/lib/college/semester";
import type { DayOfWeek, DraftSlot, TimetableDraft } from "@/types";

type Outcome =
  | { ok: true; slots: DraftSlot[]; adjustedNote: string | null }
  | { ok: false; status: number; error: string };

// Heads-up (never a rejection) when a placement lands on a period the lending
// department marked busy for this faculty.
function declaredBusyNote(
  ctx: { declaredBusyFaculty: Map<string, Set<string>> },
  facultyId: string, facultyName: string, day: string, startPeriod: number, blockSize: number,
): string | null {
  const cells = ctx.declaredBusyFaculty.get(facultyId);
  if (!cells) return null;
  const hit = Array.from({ length: blockSize }, (_, i) => startPeriod + i).filter((p) => cells.has(cellKey(day, p)));
  return hit.length > 0
    ? `${facultyName || "This faculty"} was marked busy by their department at ${day} period${hit.length > 1 ? "s" : ""} ${hit.join(", ")} - placed anyway.`
    : null;
}

// Read, hand-build, hand-edit, or discard the draft for one section.
//
// PATCH carries an `action`:
//   move   - relocate an existing placement (a period, or a whole lab block)
//   add    - place a teaching assignment into an empty cell (manual timetabling)
//   remove - clear a placement
//
// Every hard constraint is re-checked server-side on each action, so a
// hand-built timetable can never end up in a state the generator would refuse
// to produce. POST creates an empty draft, which is how a fully manual
// timetable starts (no generation required).

const sortSlots = (slots: DraftSlot[]) =>
  [...slots].sort((a, b) => (a.day === b.day ? a.periodNumber - b.periodNumber : a.day.localeCompare(b.day)));

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF",
    );
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    // Optional - the Timetable editor's own semester picker. Omitted keeps
    // the previous "whatever today's date resolves to" default.
    const semesterParam = searchParams.get("semester");
    const requestedSemester = semesterParam != null ? Number(semesterParam) : null;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Needed regardless of role, to resolve which semester's draft this is
    // (see draftDocId) - not just for the HOD scope check below.
    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const section = sectionSnap.data() as { department: string; courseId: string; year: number };

    // A draft is an in-progress, unpublished timetable - unlike the published
    // slots (visible college-wide by design), only the section's own
    // department (or an HOD who owns/manages it) may see or touch it. Checked
    // against the SECTION's department, not just an existing draft's, so this
    // also protects a section that has no draft yet.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (
        !canHodEditDepartment(scope, section.department) &&
        !(await isCrossDepartmentLender(db, session.collegeId, ownDepartmentNames(scope), sectionId))
      ) {
        return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, section.courseId, section.year);
      if (!ok) {
        const myNames = await inchargeOwnDepartmentNames(db, session.collegeId, session.uid);
        const lending = await isCrossDepartmentLender(db, session.collegeId, myNames, sectionId);
        if (!lending) {
          return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
        }
      }
    }

    const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, requestedSemester);
    if (!semesterResult.ok) {
      return NextResponse.json({ error: semesterResult.error }, { status: 400 });
    }
    const draft = await loadDraft(db, session.collegeId, sectionId, semesterResult.semester);
    return NextResponse.json({ draft });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/draft GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Starts a draft for hand editing. Normally reached only when no draft exists
 * yet (see hasDraft in the grid page - a draft persists as status PUBLISHED
 * after publish, so its own PATCH/Edit toggle covers the common re-edit case).
 * That still leaves a real gap when a section already has a live, published
 * timetable but its draft doc is gone (e.g. discarded after publishing) - a
 * blank draft would silently drop every previously generated period from
 * view the moment editing starts. So: seed from this section's current
 * GENERATED slots when there are any, instead of starting empty. MANUAL/pinned
 * slots are deliberately left out - they already show up on the grid via
 * ctx.pinnedSlots regardless of draft content, and publish never touches them
 * either (see publish/route.ts).
 */
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await readJsonBody(request)) as { sectionId?: string; semester?: number };
    const sectionId = body.sectionId;
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Validated up front (needs courseId/year, which a full loadTimetableContext
    // call would also fetch, but only after doing the heavier college-wide
    // reads below) - the Timetable editor's own semester picker letting the
    // HOD deliberately start a specific semester's draft rather than always
    // whichever one today's date resolves to.
    let requestedSemester: number | null | undefined;
    if (body.semester != null) {
      const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
      if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      const section = sectionSnap.data() as { courseId: string; year: number };
      const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, body.semester);
      if (!semesterResult.ok) return NextResponse.json({ error: semesterResult.error }, { status: 400 });
      requestedSemester = semesterResult.semester;
    }

    const ctx = await loadTimetableContext(db, session.collegeId, sectionId, requestedSemester);
    if (!ctx) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    if (!ctx.timing) {
      return NextResponse.json(
        { error: "No period timing is configured for this course year." },
        { status: 409 },
      );
    }

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (
        !canHodEditDepartment(scope, ctx.section.department) &&
        !(await isCrossDepartmentLender(db, session.collegeId, ownDepartmentNames(scope), sectionId))
      ) {
        return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, ctx.section.courseId, ctx.section.year);
      if (!ok) {
        const myNames = await inchargeOwnDepartmentNames(db, session.collegeId, session.uid);
        const lending = await isCrossDepartmentLender(db, session.collegeId, myNames, sectionId);
        if (!lending) {
          return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
        }
      }
    }

    const draft = await buildSeededDraft(db, session.collegeId, sectionId, ctx, session.email);
    const id = draftDocId(sectionId, ctx.currentSemester);
    await draftRef(db, session.collegeId, sectionId, ctx.currentSemester).set(draft);
    return NextResponse.json({ draft: { ...draft, id, generatedAt: null } });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/draft POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await readJsonBody(request)) as {
      sectionId?: string;
      action?: "move" | "add" | "remove";
      assignmentId?: string;
      fromDay?: string;
      fromPeriod?: number;
      toDay?: string;
      toPeriod?: number;
      semester?: number;
      // "add" only - explicit opt-in for a split period (see validatePlacement's
      // own doc-comment). Ignored for "move"/"remove".
      allowSplit?: boolean;
    };

    const { sectionId, assignmentId } = body;
    const action = body.action ?? "move";
    if (!sectionId || !assignmentId) {
      return NextResponse.json({ error: "sectionId and assignmentId are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Same override as POST above - which semester's draft this edit applies to.
    let requestedSemester: number | null | undefined;
    if (body.semester != null) {
      const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
      if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      const section = sectionSnap.data() as { courseId: string; year: number };
      const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, body.semester);
      if (!semesterResult.ok) return NextResponse.json({ error: semesterResult.error }, { status: 400 });
      requestedSemester = semesterResult.semester;
    }

    const ctx = await loadTimetableContext(db, session.collegeId, sectionId, requestedSemester);
    if (!ctx || !ctx.timing) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    if (!(await loadDraft(db, session.collegeId, sectionId, ctx.currentSemester))) return NextResponse.json({ error: "No draft to edit" }, { status: 404 });

    // True when the caller is here as the department that LENT this faculty (not as
    // the section's own department) - see lentNotReady below.
    let callerIsLender = false;
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, ctx.section.department)) {
        callerIsLender = await isCrossDepartmentLender(db, session.collegeId, ownDepartmentNames(scope), sectionId, assignmentId);
        if (!callerIsLender) {
          return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
        }
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, ctx.section.courseId, ctx.section.year);
      if (!ok) {
        const myNames = await inchargeOwnDepartmentNames(db, session.collegeId, session.uid);
        callerIsLender = await isCrossDepartmentLender(db, session.collegeId, myNames, sectionId, assignmentId);
        if (!callerIsLender) {
          return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
        }
      }
    }

    // Pure over the draft it's handed, so it can be re-run against a fresher
    // copy if the transaction below retries.
    const compute = (draft: TimetableDraft): Outcome => {
      let slots: DraftSlot[];
      // Set only when canPlaceAcrossBreak actually let a lab block span a
      // break - surfaced to the client as a heads-up, not a warning (the
      // block still landed exactly where clicked/dragged).
      let adjustedNote: string | null = null;

      if (action === "remove") {
        const { fromDay, fromPeriod } = body;
        if (!fromDay || !fromPeriod) {
          return { ok: false, status: 400, error: "fromDay and fromPeriod are required" };
        }
        const block = blockAt(draft, assignmentId, fromDay, Number(fromPeriod));
        if (block.length === 0) {
          return { ok: false, status: 404, error: "That slot is not in the draft" };
        }
        // Drop only this assignment's own slots, not every slot that happens to
        // share a cell (a split period has two assignments at the same
        // day+period) - `block` holds direct references into draft.slots, so
        // identity comparison scopes the removal correctly.
        slots = draft.slots.filter((s) => !block.includes(s));
      } else if (action === "add") {
        const { toDay, toPeriod } = body;
        if (!toDay || !toPeriod) {
          return { ok: false, status: 400, error: "toDay and toPeriod are required" };
        }

        const assignment = ctx.assignments.find((a) => a.id === assignmentId && !a.isPast);
        if (!assignment) {
          return { ok: false, status: 404, error: "That teaching assignment is not on this section" };
        }
        // A lent-in faculty can't be placed by the requesting side until the lending
        // department has shared their busy periods and closed the request. The
        // lender's own placing flow (callerIsLender) is not held back.
        const lendingDept = ctx.lentNotReady.get(assignmentId);
        if (lendingDept && !callerIsLender) {
          return { ok: false, status: 409, error: `${lendingDept} hasn't finished this allocation yet - you can place ${assignment.facultyName || "this faculty"} once they notify you` };
        }
        const subject = ctx.subjectsById.get(assignment.subjectId);
        const subjectType = subject?.type ?? "THEORY";
        const blockSize = subjectType === "PRACTICAL" ? Math.max(1, ctx.rules.labBlockSize) : 1;

        // Same gate as timetable-slots/route.ts's manual pin path - a split
        // period (two+ subjects/faculty sharing one cell) only makes sense for
        // parallel lab batches, not two theory classes at once.
        if (body.allowSplit && subjectType !== "PRACTICAL") {
          return { ok: false, status: 400, error: "Only lab (PRACTICAL) subjects can be split into batches" };
        }

        const placeAt = Number(toPeriod);
        const placementOpts = {
          facultyId: assignment.facultyId,
          facultyName: assignment.facultyName,
          subjectId: assignment.subjectId,
          day: toDay,
          startPeriod: placeAt,
          blockSize,
          ignore: new Set<string>(),
          allowSplit: body.allowSplit,
        };
        const problem = validatePlacement(ctx, draft, placementOpts);
        if (problem) {
          const acrossBreak = checkPlacementAcrossBreak(ctx, draft, placementOpts, problem);
          if (!acrossBreak.ok) {
            return { ok: false, status: 409, error: acrossBreak.problem };
          }
          adjustedNote = `This lab spans a break between periods ${placeAt} and ${placeAt + blockSize - 1} - placed as requested.`;
        }

        const added: DraftSlot[] = Array.from({ length: blockSize }, (_, i) => ({
          assignmentId,
          facultyId: assignment.facultyId,
          facultyName: assignment.facultyName,
          subjectId: assignment.subjectId,
          subjectName: assignment.subjectName || subject?.name || "",
          subjectType,
          day: toDay as DayOfWeek,
          periodNumber: placeAt + i,
          isBlockContinuation: i > 0,
        }));
        slots = [...draft.slots, ...added];
      } else {
        const { fromDay, fromPeriod, toDay, toPeriod } = body;
        if (!fromDay || !fromPeriod || !toDay || !toPeriod) {
          return { ok: false, status: 400, error: "fromDay, fromPeriod, toDay and toPeriod are required" };
        }
        const block = blockAt(draft, assignmentId, fromDay, Number(fromPeriod));
        if (block.length === 0) {
          return { ok: false, status: 404, error: "That slot is not in the draft" };
        }
        const moving = new Set(block.map((s) => cellKey(s.day, s.periodNumber)));

        const placeAt = Number(toPeriod);
        const placementOpts = {
          facultyId: block[0].facultyId,
          facultyName: block[0].facultyName,
          subjectId: block[0].subjectId,
          day: toDay,
          startPeriod: placeAt,
          blockSize: block.length,
          ignore: moving,
        };
        const problem = validatePlacement(ctx, draft, placementOpts);
        if (problem) {
          const acrossBreak = checkPlacementAcrossBreak(ctx, draft, placementOpts, problem);
          if (!acrossBreak.ok) {
            return { ok: false, status: 409, error: acrossBreak.problem };
          }
          adjustedNote = `This lab spans a break between periods ${placeAt} and ${placeAt + block.length - 1} - placed as requested.`;
        }

        slots = draft.slots
          // Same identity-based scoping as the "remove" branch above - `moving`
          // (cellKey-based) stays for the occupancy check in validatePlacement,
          // but vacating the source cell must not also drop a split partner
          // (a different assignment) that shares the same day+period.
          .filter((s) => !block.includes(s))
          .concat(
            block.map((s, i) => ({
              ...s,
              day: toDay as DayOfWeek,
              periodNumber: placeAt + i,
              isBlockContinuation: i > 0,
            })),
          );
      }

      // Advisory only - see declaredBusyNote.
      if (!adjustedNote && action !== "remove") {
        const placed = slots.find((sl) => sl.assignmentId === assignmentId && sl.day === (body.toDay as string) && sl.periodNumber === Number(body.toPeriod));
        if (placed) {
          const size = slots.filter((sl) => sl.assignmentId === assignmentId && sl.day === placed.day && sl.periodNumber >= placed.periodNumber && sl.periodNumber < placed.periodNumber + 8).length;
          adjustedNote = declaredBusyNote(ctx, placed.facultyId, placed.facultyName, placed.day, placed.periodNumber, Math.max(1, size));
        }
      }
      return { ok: true, slots, adjustedNote };
    };

    // Read-modify-write of the whole `slots` array, and this draft is edited by
    // both the section's own HOD and a lending department at the same time -
    // without a transaction, whichever write lands last silently discards the
    // other's placements. The draft is re-read inside the transaction and every
    // constraint is re-validated against that fresh copy.
    const ref = draftRef(db, session.collegeId, sectionId, ctx.currentSemester);
    const outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, status: 404, error: "No draft to edit" };
      const result = compute({ id: snap.id, ...snap.data() } as TimetableDraft);
      if (!result.ok) return result;
      // Any hand edit returns the timetable to draft state until republished.
      tx.set(ref, { slots: sortSlots(result.slots), status: "DRAFT", facultyIds: draftFacultyIds(result.slots) }, { merge: true });
      return result;
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    const { slots, adjustedNote } = outcome;

    return NextResponse.json({ slots: sortSlots(slots), adjustedNote });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/draft PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    // Optional - the Timetable editor's own semester picker. Omitted keeps
    // the previous "whatever today's date resolves to" default.
    const semesterParam = searchParams.get("semester");
    const requestedSemester = semesterParam != null ? Number(semesterParam) : null;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const section = sectionSnap.data() as { courseId: string; year: number };
    const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, requestedSemester);
    if (!semesterResult.ok) {
      return NextResponse.json({ error: semesterResult.error }, { status: 400 });
    }
    const ref = draftRef(db, session.collegeId, sectionId, semesterResult.semester);

    // An HOD could otherwise wipe another department's in-progress,
    // unpublished timetable outright - checked against the draft's own
    // stored `department` (set at creation, see POST above), no extra
    // Section read needed. Nothing to protect if no draft exists yet.
    if (session.role === "HOD") {
      const snap = await ref.get();
      if (snap.exists) {
        const department = (snap.data() as { department?: string }).department;
        const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
        if (!department || !canHodEditDepartment(scope, department)) {
          return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
        }
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, section.courseId, section.year);
      if (!ok) {
        return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
      }
    }

    // Discards the draft only. Published slots in `timetableSlots` are untouched,
    // so this can never remove a live timetable.
    await ref.delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/draft DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
