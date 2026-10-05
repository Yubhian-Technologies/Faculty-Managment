import { FieldValue } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { StudentAttendanceEntry, StudentAttendanceSession } from "@/types";

// "On duty" coverage: students who are officially away for given periods of a
// given day. This module is deliberately ignorant of WHY - a permission, a
// college event, a sports meet - so any feature can mark students on duty by
// calling it with its own `sourceId`, and attendance never learns about any of
// them. The attendance routes only ever ask two questions of it:
//   1. when a period's roster is built: who is on duty? (one document read)
//   2. (for the module that owns a source) retro-apply / release it.
//
// Storage - ONE document per college per day, so building a roster costs a
// single read however many students are away:
//   colleges/{collegeId}/onDutyDays/{YYYY-MM-DD}
//     { date, byStudent: { [studentId]: { [sourceId]: "ALL" | number[] } } }
// A student is covered for a period if ANY of their sources covers it, so two
// overlapping approvals can't undo each other when one is withdrawn.

export type OnDutyPeriods = "ALL" | number[];
export type OnDutyBySource = Record<string, OnDutyPeriods>;
export interface OnDutyDay { byStudent: Record<string, OnDutyBySource> }

export const onDutyDayRef = (db: Firestore, collegeId: string, date: string) =>
  db.collection("colleges").doc(collegeId).collection("onDutyDays").doc(date);

// ── pure ─────────────────────────────────────────────────────────────────────

/** Does any source cover this period? A legacy session with no period number is covered only by an "ALL" source. */
export function coversPeriod(sources: OnDutyBySource | undefined, periodNumber: number | undefined): boolean {
  if (!sources) return false;
  return Object.values(sources).some((p) => p === "ALL" || (periodNumber != null && p.includes(periodNumber)));
}

/**
 * Overlays ON_DUTY onto the entries of a period's roster. A covered student's
 * current mark is remembered in `previousStatus` (so a later withdrawal can put
 * it back); anyone no longer covered is NOT touched here (that is release's
 * job). Idempotent: running it twice gives the same entries.
 */
export function applyOnDutyToEntries(
  entries: StudentAttendanceEntry[], day: OnDutyDay | null | undefined, periodNumber: number | undefined
): StudentAttendanceEntry[] {
  if (!day) return entries;
  return entries.map((e) => {
    if (e.status === "ON_DUTY" || !coversPeriod(day.byStudent[e.studentId], periodNumber)) return e;
    return { ...e, status: "ON_DUTY", previousStatus: e.status === "PRESENT" || e.status === "ABSENT" ? e.status : null };
  });
}

/**
 * The reverse for one entry whose coverage has ended: restore what it held
 * before. If it had never been marked, a submitted session can't be left with a
 * hole (that would silently count as absent in some places and be skipped in
 * others), so it becomes ABSENT - the conservative reading, since nobody marked
 * the student present. A draft goes back to unmarked.
 */
export function releaseEntry(e: StudentAttendanceEntry, sessionSubmitted: boolean): StudentAttendanceEntry {
  if (e.status !== "ON_DUTY") return e;
  const { previousStatus, ...rest } = e;
  return { ...rest, status: previousStatus ?? (sessionSubmitted ? "ABSENT" : null) };
}

/**
 * Applies a client's mark changes to a session's entries. An ON_DUTY entry is
 * LOCKED: neither a faculty member's save nor an Office correction can change or
 * clear it (it is only lifted when whatever put the student on duty is withdrawn).
 * Untouched students keep their entry as is.
 */
export function mergeMarkUpdates(
  entries: StudentAttendanceEntry[], updates: ReadonlyMap<string, "PRESENT" | "ABSENT" | null>
): StudentAttendanceEntry[] {
  return entries.map((e) => (updates.has(e.studentId) && e.status !== "ON_DUTY" ? { ...e, status: updates.get(e.studentId) ?? null } : e));
}

export const presentCountOf = (entries: readonly StudentAttendanceEntry[]) => entries.filter((e) => e.status === "PRESENT").length;

// ── one-document-per-day reads ───────────────────────────────────────────────

export async function loadOnDutyDay(db: Firestore, collegeId: string, date: string): Promise<OnDutyDay | null> {
  const snap = await onDutyDayRef(db, collegeId, date).get();
  return snap.exists ? { byStudent: (snap.data()?.byStudent ?? {}) as OnDutyDay["byStudent"] } : null;
}

// ── writes (a source's own coverage) ─────────────────────────────────────────

/** Records `studentIds` as on duty for `periods` on each of `dates`, under `sourceId`. Safe to repeat. */
export function addOnDutyInTx(
  tx: Transaction, db: Firestore, collegeId: string,
  cover: { sourceId: string; dates: readonly string[]; studentIds: readonly string[]; periods: OnDutyPeriods }
): void {
  for (const date of cover.dates) {
    const byStudent: Record<string, OnDutyBySource> = {};
    for (const id of cover.studentIds) byStudent[id] = { [cover.sourceId]: cover.periods };
    tx.set(onDutyDayRef(db, collegeId, date), { date, byStudent }, { merge: true });
  }
}

/** Removes `sourceId`'s coverage of `studentIds` on `dates` (other sources' coverage is untouched). */
export function removeOnDutyInTx(
  tx: Transaction, db: Firestore, collegeId: string,
  cover: { sourceId: string; dates: readonly string[]; studentIds: readonly string[] }
): void {
  for (const date of cover.dates) {
    const byStudent: Record<string, Record<string, unknown>> = {};
    for (const id of cover.studentIds) byStudent[id] = { [cover.sourceId]: FieldValue.delete() };
    tx.set(onDutyDayRef(db, collegeId, date), { date, byStudent }, { merge: true });
  }
}

// ── sessions that already exist ──────────────────────────────────────────────

interface SessionTarget { department?: string; section: string; year: number; studentIds: readonly string[] }

/** Sessions on `date` for these sections that list any of the students - equality-only query, no composite index. */
async function sessionsFor(db: Firestore, collegeId: string, date: string, target: { section: string; year: number }) {
  const snap = await db.collection("colleges").doc(collegeId).collection("studentAttendance")
    .where("date", "==", date).where("sectionName", "==", target.section).where("year", "==", target.year).get();
  return snap.docs;
}

/**
 * Applies a source's coverage to sessions that were already created or even
 * submitted before it was approved (retro-apply). Each session is updated in its
 * own transaction, so one failure doesn't block the rest, and re-running it is a
 * no-op for sessions already updated. Returns how many entries changed.
 */
export async function applyOnDutyToExistingSessions(
  db: Firestore, collegeId: string,
  cover: { dates: readonly string[]; periods: OnDutyPeriods; students: readonly SessionTarget[] }
): Promise<number> {
  let changed = 0;
  const bySection = new Map<string, SessionTarget>();
  for (const s of cover.students) bySection.set(`${s.section}|${s.year}`, s);
  for (const date of cover.dates) {
    const day = await loadOnDutyDay(db, collegeId, date);
    if (!day) continue;
    for (const target of bySection.values()) {
      for (const doc of await sessionsFor(db, collegeId, date, target)) {
        changed += await db.runTransaction(async (tx) => {
          const snap = await tx.get(doc.ref);
          if (!snap.exists) return 0;
          const s = snap.data() as StudentAttendanceSession;
          const entries = applyOnDutyToEntries(s.entries, day, s.periodNumber);
          const diff = entries.filter((e, i) => e !== s.entries[i]).length;
          if (diff === 0) return 0;
          tx.update(doc.ref, { entries, presentCount: presentCountOf(entries), updatedAt: new Date() });
          return diff;
        });
      }
    }
  }
  return changed;
}

/**
 * After a source's coverage was withdrawn: puts entries back for any student who
 * is no longer covered for that period by ANY source. Returns entries changed.
 */
export async function releaseOnDutyFromSessions(
  db: Firestore, collegeId: string, cover: { dates: readonly string[]; students: readonly SessionTarget[] }
): Promise<number> {
  let changed = 0;
  const bySection = new Map<string, SessionTarget>();
  for (const s of cover.students) bySection.set(`${s.section}|${s.year}`, s);
  for (const date of cover.dates) {
    const day = await loadOnDutyDay(db, collegeId, date);
    for (const target of bySection.values()) {
      const ids = new Set(target.studentIds);
      for (const doc of await sessionsFor(db, collegeId, date, target)) {
        changed += await db.runTransaction(async (tx) => {
          const snap = await tx.get(doc.ref);
          if (!snap.exists) return 0;
          const s = snap.data() as StudentAttendanceSession;
          let diff = 0;
          const entries = s.entries.map((e) => {
            if (!ids.has(e.studentId) || e.status !== "ON_DUTY") return e;
            if (coversPeriod(day?.byStudent[e.studentId], s.periodNumber)) return e; // still covered by another source
            diff += 1;
            return releaseEntry(e, s.status === "SUBMITTED");
          });
          if (diff === 0) return 0;
          tx.update(doc.ref, { entries, presentCount: presentCountOf(entries), updatedAt: new Date() });
          return diff;
        });
      }
    }
  }
  return changed;
}
