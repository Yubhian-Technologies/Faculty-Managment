import { MAX_FACULTY_PER_SUBJECT } from "@/lib/teaching/facultyCap";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { DraftSlot, TimetableDraft, TimetableSlot } from "@/types";
import { bumpGuards, facultyGuard, lockGuards, sectionGuard } from "@/lib/timetable/guards";
import { draftFacultyIds } from "@/lib/timetable/draftAccess";
import type { SlotIdentity } from "@/lib/timetable/liveSlots";

// Publishing a draft = replacing a section's GENERATED slots with the draft's.
//
// It used to be: read every slot in the college, check clashes, then delete the
// stale slots and insert the new ones across SEVERAL independent batch commits,
// the draft marked published in the last. A failure part-way left a partial
// timetable (some old slots gone, some new ones missing); and two sections
// publishing at the same moment could both pass the clash check and double-book
// a faculty member. Now it is ONE transaction: it locks the section's guard
// document and each involved faculty member's (lib/timetable/guards.ts), reads
// only what it needs (this section's slots, the involved faculty's slots),
// re-validates, and writes the slots, the deletions and the draft's new status
// together - all of it or none of it, and any other publish touching the same
// faculty runs before or after it, never alongside.
//
// New slots get deterministic ids (section + session + semester + cell +
// assignment), so republishing an unchanged cell reuses its slot id - anything
// that refers to a slot by id (a leave substitution's timetableSlotId) keeps
// pointing at it - and re-running a publish is idempotent.

export type PublishOutcome =
  | { ok: true; published: number; replaced: number; droppedStaleAssignments: number; slotIds: string[] }
  | { ok: false; status: number; error: string; issues?: string[] };

export interface PublishInput {
  db: Firestore;
  collegeId: string;
  draftId: string;
  section: { id: string; department: string; courseId: string; year: number };
  semester: number | null;
  currentAcademicYear: string;
  /** Whether ANOTHER section's slot is part of the live timetable (its own course-year's semester + session). */
  isLiveSlot: (slot: SlotIdentity) => boolean;
  publishedByName: string;
  writer: string;
  /** "w.e.f" date (YYYY-MM-DD) printed on the timetable; stored on the slots and the draft. */
  effectiveDate?: string;
}

// A transaction holds at most 500 writes; leave room for the guards and draft.
export const MAX_PUBLISH_WRITES = 450;

const safeIdPart = (v: string | number | null) => String(v ?? "all").replace(/[^A-Za-z0-9_-]/g, "_");

export function publishedSlotId(
  sectionId: string, academicYear: string, semester: number | null, s: Pick<DraftSlot, "day" | "periodNumber" | "assignmentId">
): string {
  return ["pub", sectionId, academicYear, semester, s.day, s.periodNumber, s.assignmentId].map(safeIdPart).join("_");
}

const cellOf = (day: string, period: number) => `${day}:${period}`;

export async function publishSectionDraft(input: PublishInput): Promise<PublishOutcome> {
  const { db, collegeId, section, semester, currentAcademicYear } = input;
  const collegeRef = db.collection("colleges").doc(collegeId);
  const slotsCol = collegeRef.collection("timetableSlots");
  const draftRef = collegeRef.collection("timetableDrafts").doc(input.draftId);

  return db.runTransaction(async (tx): Promise<PublishOutcome> => {
    // The draft is read first - the faculty involved are only known from it,
    // and each of their guards has to be locked before anything is decided.
    // Reading it also locks it: a hand edit landing mid-publish makes one of
    // the two retry rather than letting a half-old draft through.
    const draftSnap = await tx.get(draftRef);
    if (!draftSnap.exists) return { ok: false, status: 404, error: "No draft to publish" };
    const draft = { id: draftSnap.id, ...draftSnap.data() } as TimetableDraft;
    if (!draft.slots?.length) return { ok: false, status: 400, error: "This draft has no slots to publish" };

    const guards = [
      sectionGuard(db, collegeId, section.id),
      ...draftFacultyIds(draft.slots).map((f) => facultyGuard(db, collegeId, f)),
    ];
    await lockGuards(tx, guards);

    const [assignmentsSnap, ownSlotsSnap] = await Promise.all([
      tx.get(collegeRef.collection("teachingAssignments").where("sectionId", "==", section.id)),
      tx.get(slotsCol.where("sectionId", "==", section.id)),
    ]);

    // A draft can carry placements for a TeachingAssignment that's since been
    // deleted (assignment deletion cascades live timetableSlots but has no
    // way to reach back into an in-progress, unpublished draft's own slots
    // array) - publishing those anyway would put a faculty/subject pairing
    // the HOD believed was removed back onto the live timetable. Drop them
    // here, the one place every draft->live transition goes through,
    // regardless of how the draft ended up stale.
    const validAssignmentIds = new Set(assignmentsSnap.docs.map((d) => d.id));
    const publishable = draft.slots.filter((s) => validAssignmentIds.has(s.assignmentId));
    const droppedCount = draft.slots.length - publishable.length;
    if (publishable.length === 0) {
      return {
        ok: false, status: 400,
        error: "Every placement in this draft belongs to a teaching assignment that's since been removed. Discard the draft and rebuild it.",
      };
    }

    // This section's own slots in the live timetable.
    const own = ownSlotsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as object) }) as TimetableSlot)
      .filter((s) => input.isLiveSlot(s));
    const stale = own.filter((s) => s.source === "GENERATED");
    // Slots written before `source` existed are manual by definition.
    const pinned = own.filter((s) => s.source !== "GENERATED");

    // ── Re-validate the section's cells (F-23) ──────────────────────────────
    const issues: string[] = [];
    const pinnedCells = new Set(pinned.map((s) => cellOf(s.day, s.periodNumber)));
    const byCell = new Map<string, DraftSlot[]>();
    for (const s of publishable) {
      const k = cellOf(s.day, s.periodNumber);
      byCell.set(k, [...(byCell.get(k) ?? []), s]);
    }
    for (const [cell, inCell] of byCell) {
      const [day, period] = cell.split(":");
      if (pinnedCells.has(cell)) {
        issues.push(`${day} period ${period} now holds a pinned slot, so the draft's placement there can't be published. Regenerate this timetable.`);
      } else if (inCell.length > 1) {
        // Several faculty of ONE subject may share the cell (co-teaching, any subject type); two
        // different subjects may share it only if both are labs - each lab with any number of faculty.
        const bySubject = new Map<string, DraftSlot[]>();
        for (const s of inCell) bySubject.set(s.subjectId, [...(bySubject.get(s.subjectId) ?? []), s]);
        const subjects = Array.from(bySubject.values());
        const allLabs = inCell.every((s) => s.subjectType === "PRACTICAL");
        const tooManyFaculty = subjects.some((g) => g.length > MAX_FACULTY_PER_SUBJECT);
        if (tooManyFaculty || subjects.length > 2 || (subjects.length === 2 && !allLabs)) {
          issues.push(`${day} period ${period} has ${subjects.length} subjects in it - only two labs may share a period (each with its faculty), or several faculty of the same subject. Regenerate this timetable.`);
        }
      }
    }

    // No faculty double-booking check: years run their own period timings, so
    // the same faculty member may hold the same period in two sections (same
    // rule as draftPlacement.ts and pinSlot.ts, which never reject it either).

    if (issues.length > 0) {
      return { ok: false, status: 409, error: "Conflicts appeared since this draft was generated", issues: [...new Set(issues)] };
    }

    // ── Write: new slots, the stale ones they replace, the draft's status ────
    const newIds = publishable.map((s) => publishedSlotId(section.id, currentAcademicYear, semester, s));
    if (new Set(newIds).size !== newIds.length) {
      return { ok: false, status: 400, error: "This draft places the same subject twice in one period. Regenerate this timetable." };
    }
    const keep = new Set(newIds);
    const toDelete = stale.filter((s) => !keep.has(s.id));
    const writes = publishable.length + toDelete.length + 1 + guards.length;
    if (writes > MAX_PUBLISH_WRITES) {
      return {
        ok: false, status: 400,
        error: `This timetable has too many placements (${publishable.length}) to publish in one go. Split it across fewer periods and try again.`,
      };
    }

    const now = FieldValue.serverTimestamp();
    for (const s of toDelete) tx.delete(slotsCol.doc(s.id));
    publishable.forEach((s, i) => {
      tx.set(slotsCol.doc(newIds[i]), {
        collegeId,
        department: section.department,
        assignmentId: s.assignmentId,
        facultyId: s.facultyId,
        facultyName: s.facultyName,
        courseId: section.courseId,
        year: Number(section.year),
        sectionId: section.id,
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        day: s.day,
        periodNumber: s.periodNumber,
        source: "GENERATED",
        isPinned: false,
        semester,
        academicYear: currentAcademicYear,
        ...(input.effectiveDate ? { effectiveDate: input.effectiveDate } : {}),
        createdAt: now,
        updatedAt: now,
      });
    });
    tx.update(draftRef, {
      ...(input.effectiveDate ? { effectiveDate: input.effectiveDate } : {}),
      status: "PUBLISHED",
      semester,
      academicYear: currentAcademicYear,
      publishedAt: now,
      publishedByName: input.publishedByName,
      facultyIds: draftFacultyIds(draft.slots),
    });
    bumpGuards(tx, guards, input.writer);

    return { ok: true, published: publishable.length, replaced: stale.length, droppedStaleAssignments: droppedCount, slotIds: newIds };
  });
}
