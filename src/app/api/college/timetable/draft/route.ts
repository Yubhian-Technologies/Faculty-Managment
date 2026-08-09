export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { loadTimetableContext, pinnedCells, type TimetableContext } from "@/lib/timetable/loadContext";
import { isContiguousBlockAvailable } from "@/lib/timetable/buildGrid";
import type { DayOfWeek, DraftSlot, TimetableDraft } from "@/types";

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

async function loadDraft(db: FirebaseFirestore.Firestore, collegeId: string, sectionId: string) {
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("timetableDrafts").doc(sectionId)
    .get();
  return snap.exists ? ({ id: snap.id, ...snap.data() } as TimetableDraft) : null;
}

function draftRef(db: FirebaseFirestore.Firestore, collegeId: string, sectionId: string) {
  return db.collection("colleges").doc(collegeId)
    .collection("timetableDrafts").doc(sectionId);
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
  },
): string | null {
  const { timing, rules } = ctx;
  if (!timing) return "No period timing is configured for this course year.";
  const { facultyId, facultyName, day, startPeriod, blockSize, ignore } = opts;

  if (!rules.workingDays.includes(day as DayOfWeek)) return `${day} is not a working day.`;

  if (!isContiguousBlockAvailable(timing, startPeriod, blockSize, rules.allowLabAcrossBreaks)) {
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
    if (occupied.has(key)) return `This section already has a subject at ${day} period ${p}.`;
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

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "SUPER_ADMIN",
    );
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });

    const db = getAdminDb();
    const draft = await loadDraft(db, session.collegeId, sectionId);
    return NextResponse.json({ draft });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/draft GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Starts an empty draft so a timetable can be built entirely by hand. */
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { sectionId?: string };
    const sectionId = body.sectionId;
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });

    const db = getAdminDb();
    const ctx = await loadTimetableContext(db, session.collegeId, sectionId);
    if (!ctx) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    if (!ctx.timing) {
      return NextResponse.json(
        { error: "No period timing is configured for this course year." },
        { status: 409 },
      );
    }

    const draft = {
      collegeId: session.collegeId,
      department: ctx.section.department,
      courseId: ctx.section.courseId,
      year: Number(ctx.section.year),
      sectionId,
      sectionName: ctx.section.name,
      status: "DRAFT" as const,
      slots: [] as DraftSlot[],
      diagnostics: ["Started as a blank timetable - add subjects by clicking a period."],
      generatedAt: FieldValue.serverTimestamp(),
      generatedByName: session.email,
    };

    await draftRef(db, session.collegeId, sectionId).set(draft);
    return NextResponse.json({ draft: { ...draft, id: sectionId, generatedAt: null } });
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      sectionId?: string;
      action?: "move" | "add" | "remove";
      assignmentId?: string;
      fromDay?: string;
      fromPeriod?: number;
      toDay?: string;
      toPeriod?: number;
    };

    const { sectionId, assignmentId } = body;
    const action = body.action ?? "move";
    if (!sectionId || !assignmentId) {
      return NextResponse.json({ error: "sectionId and assignmentId are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const [ctx, draft] = await Promise.all([
      loadTimetableContext(db, session.collegeId, sectionId),
      loadDraft(db, session.collegeId, sectionId),
    ]);
    if (!ctx || !ctx.timing) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    if (!draft) return NextResponse.json({ error: "No draft to edit" }, { status: 404 });

    let slots: DraftSlot[];

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

      const problem = validatePlacement(ctx, draft, {
        facultyId: assignment.facultyId,
        facultyName: assignment.facultyName,
        day: toDay,
        startPeriod: Number(toPeriod),
        blockSize,
        ignore: new Set(),
      });
      if (problem) return NextResponse.json({ error: problem }, { status: 409 });

      const added: DraftSlot[] = Array.from({ length: blockSize }, (_, i) => ({
        assignmentId,
        facultyId: assignment.facultyId,
        facultyName: assignment.facultyName,
        subjectId: assignment.subjectId,
        subjectName: assignment.subjectName || subject?.name || "",
        subjectType,
        day: toDay as DayOfWeek,
        periodNumber: Number(toPeriod) + i,
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

      const problem = validatePlacement(ctx, draft, {
        facultyId: block[0].facultyId,
        facultyName: block[0].facultyName,
        day: toDay,
        startPeriod: Number(toPeriod),
        blockSize: block.length,
        ignore: moving,
      });
      if (problem) return NextResponse.json({ error: problem }, { status: 409 });

      slots = draft.slots
        .filter((s) => !moving.has(cellKey(s.day, s.periodNumber)))
        .concat(
          block.map((s, i) => ({
            ...s,
            day: toDay as DayOfWeek,
            periodNumber: Number(toPeriod) + i,
            isBlockContinuation: i > 0,
          })),
        );
    }

    // Any hand edit returns the timetable to draft state until republished.
    await draftRef(db, session.collegeId, sectionId)
      .set({ slots: sortSlots(slots), status: "DRAFT" }, { merge: true });

    return NextResponse.json({ slots: sortSlots(slots) });
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });

    // Discards the draft only. Published slots in `timetableSlots` are untouched,
    // so this can never remove a live timetable.
    await draftRef(getAdminDb(), session.collegeId, sectionId).delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/draft DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
