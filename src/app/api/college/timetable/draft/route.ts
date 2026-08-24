export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { loadTimetableContext, pinnedCells, type TimetableContext } from "@/lib/timetable/loadContext";
import { isContiguousBlockAvailable, periodsFollowedByBreak } from "@/lib/timetable/buildGrid";
import { getHodDepartmentScope, canHodEditDepartment, ownDepartmentNames } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { resolveRequestedSemester, matchesCurrentSemester, draftDocId } from "@/lib/college/semester";
import type { DayOfWeek, DraftSlot, TimetableDraft, TimetableSlot } from "@/types";

// A lending HOD or Timetable Incharge (see api/college/faculty-assignment-requests)
// doesn't own this section's department, but legitimately needs to place/move/remove
// periods for the one TeachingAssignment they were allocated - the section's
// own HOD publishes, they only "Notify" (see the timetable grid page).
// Scoped to ALLOCATED requests only (never PENDING/DECLINED), and - when
// `assignmentId` is given - to that exact assignment, so a lender can
// never touch another department's other subjects via this exception.
async function findAllocatedRequestsForSection(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  sectionId: string,
): Promise<{ targetDepartmentName?: string; teachingAssignmentId?: string }[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("facultyAssignmentRequests")
    .where("sectionId", "==", sectionId)
    .where("status", "==", "ALLOCATED")
    .get();
  return snap.docs.map((d) => d.data() as { targetDepartmentName?: string; teachingAssignmentId?: string });
}

// `myNames` is either an HOD's own department scope (ownDepartmentNames) or
// - for a Timetable Incharge fulfilling on behalf of their department - just
// the single department name they're Incharge for. Either way this only
// grants access to a section that ISN'T theirs when their own department was
// the one allocated to lend a faculty member for it.
async function isCrossDepartmentLender(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  myNames: string[],
  sectionId: string,
  assignmentId?: string,
): Promise<boolean> {
  if (myNames.length === 0) return false;
  const allocated = await findAllocatedRequestsForSection(db, collegeId, sectionId);
  return allocated.some(
    (r) => myNames.includes(r.targetDepartmentName ?? "") && (!assignmentId || r.teachingAssignmentId === assignmentId),
  );
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

async function loadDraft(db: FirebaseFirestore.Firestore, collegeId: string, sectionId: string, semester: number | null) {
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("timetableDrafts").doc(draftDocId(sectionId, semester))
    .get();
  return snap.exists ? ({ id: snap.id, ...snap.data() } as TimetableDraft) : null;
}

function draftRef(db: FirebaseFirestore.Firestore, collegeId: string, sectionId: string, semester: number | null) {
  return db.collection("colleges").doc(collegeId)
    .collection("timetableDrafts").doc(draftDocId(sectionId, semester));
}

const cellKey = (day: string, period: number) => `${day}:${period}`;

/**
 * Shared hard-constraint check for placing `blockSize` periods starting at
 * (day, startPeriod). `ignore` holds cells being vacated by the same action, so
 * moving a block one period sideways isn't blocked by its own current cells.
 */
function validatePlacement(
  ctx: TimetableContext,
  draft: TimetableDraft,
  opts: {
    facultyId: string;
    facultyName: string;
    day: string;
    startPeriod: number;
    blockSize: number;
    ignore: Set<string>;
    // Overrides rules.allowLabAcrossBreaks for this one check - used by the
    // "add"/"move" retry below, which re-validates the SAME requested
    // periods with breaks allowed once the plain check rejects them for
    // that reason alone. Omitted uses the college's own configured rule.
    allowAcrossBreaks?: boolean;
    // Explicit opt-in for a split period (two+ subjects/faculty sharing one
    // section+day+period) - only ever set by the manual "add" action below
    // when a human deliberately chose to add another subject to an already-
    // occupied cell, never by the auto-generator. Skips ONLY the
    // already-occupied check; pinned/faculty-busy/daily-cap still apply.
    allowSplit?: boolean;
  },
): string | null {
  const { timing, rules } = ctx;
  if (!timing) return "No period timing is configured for this course year.";
  const { facultyId, facultyName, day, startPeriod, blockSize, ignore } = opts;
  const allowAcrossBreaks = opts.allowAcrossBreaks ?? rules.allowLabAcrossBreaks;

  if (!rules.workingDays.includes(day as DayOfWeek)) return `${day} is not a working day.`;

  if (!isContiguousBlockAvailable(timing, startPeriod, blockSize, allowAcrossBreaks)) {
    return blockSize > 1
      ? `This lab needs ${blockSize} continuous periods; they do not fit at period ${startPeriod} without crossing a break.`
      : `Period ${startPeriod} is outside the ${timing.numberOfPeriods}-period day.`;
  }

  const pinned = pinnedCells(ctx.pinnedSlots);
  const occupied = new Set(
    draft.slots
      .map((s) => cellKey(s.day, s.periodNumber))
      .filter((k) => !ignore.has(k)),
  );
  const facultyBusy = ctx.busyFaculty.get(facultyId) ?? new Set<string>();

  for (let i = 0; i < blockSize; i++) {
    const p = startPeriod + i;
    const key = cellKey(day, p);
    if (pinned.has(key)) return `Period ${p} on ${day} holds a pinned slot.`;
    if (occupied.has(key) && !opts.allowSplit) return `This section already has a subject at ${day} period ${p}.`;
    if (facultyBusy.has(key)) {
      return `${facultyName} is already teaching another section at ${day} period ${p}.`;
    }
  }

  // Per-faculty daily cap: the rest of this draft, plus other sections.
  const sameDay = draft.slots.filter(
    (s) => s.facultyId === facultyId && s.day === day && !ignore.has(cellKey(s.day, s.periodNumber)),
  ).length;
  const otherSections = Array.from(facultyBusy).filter((c) => c.startsWith(`${day}:`)).length;
  if (sameDay + otherSections + blockSize > rules.maxPeriodsPerFacultyPerDay) {
    return `${facultyName} would exceed the ${rules.maxPeriodsPerFacultyPerDay} periods/day limit on ${day}.`;
  }

  return null;
}

/** The contiguous run of slots that belong to one placement (a lab block or a single period). */
function blockAt(draft: TimetableDraft, assignmentId: string, day: string, period: number): DraftSlot[] {
  const anchor = draft.slots.find(
    (s) => s.assignmentId === assignmentId && s.day === day && s.periodNumber === period,
  );
  if (!anchor) return [];

  let start = anchor;
  while (start.isBlockContinuation) {
    const prev = draft.slots.find(
      (s) => s.assignmentId === assignmentId && s.day === day && s.periodNumber === start.periodNumber - 1,
    );
    if (!prev) break;
    start = prev;
  }

  const block = [start];
  for (let p = start.periodNumber + 1; ; p++) {
    const next = draft.slots.find(
      (s) => s.assignmentId === assignmentId && s.day === day && s.periodNumber === p && s.isBlockContinuation,
    );
    if (!next) break;
    block.push(next);
  }
  return block;
}

const sortSlots = (slots: DraftSlot[]) =>
  [...slots].sort((a, b) => (a.day === b.day ? a.periodNumber - b.periodNumber : a.day.localeCompare(b.day)));

// A Timetable Incharge (PANEL_MEMBER/COLLEGE_STAFF) always has exactly one
// home department (the assignment POST validates the person's own
// department matches the delegated course's), unlike an HOD's own
// scope/ownDepartmentNames which can span more than one - so this is just
// their login's own `department` field, wrapped as a one-item list for
// isCrossDepartmentLender's shared shape.
async function inchargeOwnDepartmentNames(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string,
): Promise<string[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  const department = (snap.data() as { department?: string } | undefined)?.department;
  return department ? [department] : [];
}

/**
 * When a multi-period lab placement fails specifically because a break falls
 * INSIDE it - not because of a day-boundary, an occupied cell, a faculty
 * conflict, or the daily cap - retries the EXACT SAME requested periods with
 * that break allowed, instead of rejecting outright. A 3-period lab clicked
 * starting where a short break/lunch falls between two of its periods (e.g.
 * periods 1-2, then a break, then period 3) is a completely normal way to
 * run a lab in practice - the break is just a natural pause partway through,
 * not a reason to bounce the whole block to a different time. Never touches
 * a same-day placement failure for any OTHER reason (those still reject as
 * before), and never relocates the block - it always lands on exactly the
 * periods that were clicked/dragged to.
 *
 * Returns `{ ok: true }` when the break-crossing placement is fine, or
 * `{ ok: false, problem }` where `problem` is the ORIGINAL (break-crossing)
 * error when there was no break involved at all, but the RETRY's own error
 * (e.g. "already teaching another section at period 3") when the block still
 * can't go there for some other reason even with the break allowed - so the
 * message the caller ever sees always names the real blocker, never a stale
 * "crossing a break" message once the break itself was never the problem.
 */
function checkPlacementAcrossBreak(
  ctx: TimetableContext,
  draft: TimetableDraft,
  opts: {
    facultyId: string;
    facultyName: string;
    day: string;
    startPeriod: number;
    blockSize: number;
    ignore: Set<string>;
  },
  originalProblem: string,
): { ok: true } | { ok: false; problem: string } {
  const { timing, rules } = ctx;
  if (!timing || rules.allowLabAcrossBreaks || opts.blockSize <= 1) {
    return { ok: false, problem: originalProblem };
  }
  const breaks = periodsFollowedByBreak(timing);
  const hasInteriorBreak = Array.from(
    { length: opts.blockSize - 1 },
    (_, i) => opts.startPeriod + i,
  ).some((p) => breaks.has(p));
  // The failure wasn't about a break at all (occupied/busy/day-boundary/cap) -
  // nothing to override, the original error already names the real reason.
  if (!hasInteriorBreak) return { ok: false, problem: originalProblem };
  const retryProblem = validatePlacement(ctx, draft, { ...opts, allowAcrossBreaks: true });
  return retryProblem ? { ok: false, problem: retryProblem } : { ok: true };
}

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
    const body = (await request.json()) as { sectionId?: string; semester?: number };
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

    const publishedSnap = await collegeRef.collection("timetableSlots")
      .where("sectionId", "==", sectionId).where("source", "==", "GENERATED").get();
    // Only this section's CURRENT semester's own published slots (plus any
    // legacy ones with no semester tag at all) seed the new draft - a prior
    // semester's published GENERATED slots stay as history, not something
    // building "now" should silently resurrect.
    const published = publishedSnap.docs
      .map((d) => d.data() as TimetableSlot)
      .filter((s) => matchesCurrentSemester(s.semester, ctx.currentSemester));

    // A block's 2nd..Nth period is the only thing that needs recomputing -
    // everything else on TimetableSlot maps straight onto DraftSlot.
    const continuationKeys = new Set<string>();
    const byAssignmentDay = new Map<string, Set<number>>();
    for (const s of published) {
      const key = `${s.assignmentId}|${s.day}`;
      const periods = byAssignmentDay.get(key) ?? new Set<number>();
      periods.add(s.periodNumber);
      byAssignmentDay.set(key, periods);
    }
    for (const s of published) {
      const periods = byAssignmentDay.get(`${s.assignmentId}|${s.day}`)!;
      if (periods.has(s.periodNumber - 1)) continuationKeys.add(`${s.assignmentId}|${s.day}|${s.periodNumber}`);
    }

    const seededSlots: DraftSlot[] = published.map((s) => ({
      assignmentId: s.assignmentId,
      facultyId: s.facultyId,
      facultyName: s.facultyName,
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      subjectType: ctx.subjectsById.get(s.subjectId)?.type ?? "THEORY",
      day: s.day,
      periodNumber: s.periodNumber,
      isBlockContinuation: continuationKeys.has(`${s.assignmentId}|${s.day}|${s.periodNumber}`),
    }));

    const draft = {
      collegeId: session.collegeId,
      department: ctx.section.department,
      courseId: ctx.section.courseId,
      year: Number(ctx.section.year),
      sectionId,
      sectionName: ctx.section.name,
      semester: ctx.currentSemester,
      status: "DRAFT" as const,
      slots: seededSlots,
      diagnostics: seededSlots.length > 0
        ? ["Started from the currently published timetable - edit and republish when ready."]
        : ["Started as a blank timetable - add subjects by clicking a period."],
      generatedAt: FieldValue.serverTimestamp(),
      generatedByName: session.email,
    };

    const id = draftDocId(sectionId, ctx.currentSemester);
    await draftRef(db, session.collegeId, sectionId, ctx.currentSemester).set(draft);
    return NextResponse.json({ draft: { ...draft, id, generatedAt: null } });
  } catch (err) {
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
    const body = (await request.json()) as {
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
    const draft = await loadDraft(db, session.collegeId, sectionId, ctx.currentSemester);
    if (!draft) return NextResponse.json({ error: "No draft to edit" }, { status: 404 });

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (
        !canHodEditDepartment(scope, ctx.section.department) &&
        !(await isCrossDepartmentLender(db, session.collegeId, ownDepartmentNames(scope), sectionId, assignmentId))
      ) {
        return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, ctx.section.courseId, ctx.section.year);
      if (!ok) {
        const myNames = await inchargeOwnDepartmentNames(db, session.collegeId, session.uid);
        const lending = await isCrossDepartmentLender(db, session.collegeId, myNames, sectionId, assignmentId);
        if (!lending) {
          return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
        }
      }
    }

    let slots: DraftSlot[];
    // Set only when canPlaceAcrossBreak actually let a lab block span a
    // break - surfaced to the client as a heads-up, not a warning (the
    // block still landed exactly where clicked/dragged).
    let adjustedNote: string | null = null;

    if (action === "remove") {
      const { fromDay, fromPeriod } = body;
      if (!fromDay || !fromPeriod) {
        return NextResponse.json({ error: "fromDay and fromPeriod are required" }, { status: 400 });
      }
      const block = blockAt(draft, assignmentId, fromDay, Number(fromPeriod));
      if (block.length === 0) {
        return NextResponse.json({ error: "That slot is not in the draft" }, { status: 404 });
      }
      const drop = new Set(block.map((s) => cellKey(s.day, s.periodNumber)));
      slots = draft.slots.filter((s) => !drop.has(cellKey(s.day, s.periodNumber)));
    } else if (action === "add") {
      const { toDay, toPeriod } = body;
      if (!toDay || !toPeriod) {
        return NextResponse.json({ error: "toDay and toPeriod are required" }, { status: 400 });
      }

      const assignment = ctx.assignments.find((a) => a.id === assignmentId && !a.isPast);
      if (!assignment) {
        return NextResponse.json({ error: "That teaching assignment is not on this section" }, { status: 404 });
      }
      const subject = ctx.subjectsById.get(assignment.subjectId);
      const subjectType = subject?.type ?? "THEORY";
      const blockSize = subjectType === "PRACTICAL" ? Math.max(1, ctx.rules.labBlockSize) : 1;

      const placeAt = Number(toPeriod);
      const placementOpts = {
        facultyId: assignment.facultyId,
        facultyName: assignment.facultyName,
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
          return NextResponse.json({ error: acrossBreak.problem }, { status: 409 });
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
        return NextResponse.json(
          { error: "fromDay, fromPeriod, toDay and toPeriod are required" },
          { status: 400 },
        );
      }
      const block = blockAt(draft, assignmentId, fromDay, Number(fromPeriod));
      if (block.length === 0) {
        return NextResponse.json({ error: "That slot is not in the draft" }, { status: 404 });
      }
      const moving = new Set(block.map((s) => cellKey(s.day, s.periodNumber)));

      const placeAt = Number(toPeriod);
      const placementOpts = {
        facultyId: block[0].facultyId,
        facultyName: block[0].facultyName,
        day: toDay,
        startPeriod: placeAt,
        blockSize: block.length,
        ignore: moving,
      };
      const problem = validatePlacement(ctx, draft, placementOpts);
      if (problem) {
        const acrossBreak = checkPlacementAcrossBreak(ctx, draft, placementOpts, problem);
        if (!acrossBreak.ok) {
          return NextResponse.json({ error: acrossBreak.problem }, { status: 409 });
        }
        adjustedNote = `This lab spans a break between periods ${placeAt} and ${placeAt + block.length - 1} - placed as requested.`;
      }

      slots = draft.slots
        .filter((s) => !moving.has(cellKey(s.day, s.periodNumber)))
        .concat(
          block.map((s, i) => ({
            ...s,
            day: toDay as DayOfWeek,
            periodNumber: placeAt + i,
            isBlockContinuation: i > 0,
          })),
        );
    }

    // Any hand edit returns the timetable to draft state until republished.
    await draftRef(db, session.collegeId, sectionId, ctx.currentSemester)
      .set({ slots: sortSlots(slots), status: "DRAFT" }, { merge: true });

    return NextResponse.json({ slots: sortSlots(slots), adjustedNote });
  } catch (err) {
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
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/draft DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
