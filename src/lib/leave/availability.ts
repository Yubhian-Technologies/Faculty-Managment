import type { Firestore } from "firebase-admin/firestore";
import { isoDateKey } from "@/lib/leave/dayCounter";
import type { LeaveRequest, PeriodSubstitution, StaffAdjustment } from "@/types/leave";

// Everything that makes someone unavailable on a given date, beyond their own
// timetable - shared by every "who can I name as a substitute / handover /
// cover" list so they all agree (period-coverage, handover-candidates and the
// Adjustments module).
//
//  - a leave request that hasn't been rejected/cancelled: PENDING ones count
//    too, because someone whose own leave is still awaiting approval shouldn't
//    be handed someone else's classes either;
//  - being the SUBJECT of an active staff adjustment (they have other work
//    that day);
//  - already covering a period on that date - for an approved/pending leave's
//    substitutions or another active adjustment - so the same person can't be
//    double-booked into one slot by two different requests.

const LIVE_LEAVE_STATUSES = ["PENDING_ACCEPTANCE", "PENDING_HOD", "PENDING_PRINCIPAL", "PENDING_VICE_PRINCIPAL", "PENDING_MANAGEMENT", "APPROVED"] as const;

function toISODate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const asDate = typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate(): Date }).toDate()
    : value instanceof Date ? value : null;
  return asDate ? isoDateKey(asDate) : null;
}

interface LiveLeave {
  requestId: string;
  uid: string;
  fromISO: string;
  toISO: string;
  substitutions: PeriodSubstitution[];
}

export interface Unavailability {
  /** On live leave, or the subject of an active adjustment, on this date. */
  isUnavailableOn(uid: string, dateISO: string): boolean;
  /** Already named to cover this exact date + period number by some other request. */
  isCoveringAt(facultyId: string, dateISO: string, periodNumber: number): boolean;
  /** uids unavailable on ANY day within [fromISO, toISO]. */
  unavailableUidsBetween(fromISO: string, toISO: string): Set<string>;
  /** FacultyMember ids already committed (live leave sub, or active adjustment) to cover ANY period within [fromISO, toISO] - so a covering commitment can be checked against the applicant themselves, not just the pool of candidates. */
  coveringFacultyIdsBetween(fromISO: string, toISO: string): Set<string>;
}

export interface SubstitutePick {
  substituteFacultyId: string;
  substituteFacultyName?: string;
  date: string;
  periodNumber: number;
  subjectName?: string;
}

export interface SubstituteConflict extends SubstitutePick {
  /** ALREADY_COVERING - some OTHER live request already has them in this slot.
   *  DUPLICATE_IN_SUBMISSION - two picks in THIS submission put them in it. */
  reason: "ALREADY_COVERING" | "DUPLICATE_IN_SUBMISSION";
}

/**
 * Every way a set of proposed picks can double-book someone, in one place.
 *
 * Keyed on (facultyId, date, periodNumber) and NOT on timetableSlotId, which
 * is the hole this closes: two slots can share a period - merged sections, an
 * elective split, a lab running against a theory class - and one person cannot
 * teach both. buildPeriodCoverage resolves each period's candidates
 * independently from the same snapshot, so the same free person is legitimately
 * offered for both, and the caller's only de-duplication was on
 * `date|timetableSlotId`, which those two periods do not share.
 *
 * `isCoveringAt` is optional because the two callers need different halves.
 * validatePeriodSubstitutions omits it - a pick that is already covering was
 * never in the period's candidate list, so that half is already enforced one
 * step earlier and re-reading Firestore for it would be waste. The acceptance
 * path passes it, because that check ran when the proposal was MADE and
 * anything could have changed since.
 */
export function findSubstituteConflicts(
  picks: SubstitutePick[],
  opts: { isCoveringAt?: (facultyId: string, dateISO: string, periodNumber: number) => boolean } = {}
): SubstituteConflict[] {
  const conflicts: SubstituteConflict[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    const key = `${pick.substituteFacultyId}|${pick.date}|${pick.periodNumber}`;
    if (seen.has(key)) {
      conflicts.push({ ...pick, reason: "DUPLICATE_IN_SUBMISSION" });
      continue;
    }
    seen.add(key);
    if (opts.isCoveringAt?.(pick.substituteFacultyId, pick.date, pick.periodNumber)) {
      conflicts.push({ ...pick, reason: "ALREADY_COVERING" });
    }
  }
  return conflicts;
}

/** One conflict, worded for the person who has to act on it. */
export function describeSubstituteConflict(c: SubstituteConflict): string {
  const who = c.substituteFacultyName ?? "That faculty member";
  const where = c.subjectName ? `${c.subjectName} on ${c.date}` : c.date;
  return c.reason === "DUPLICATE_IN_SUBMISSION"
    ? `${who} is picked twice for period ${c.periodNumber} on ${c.date} - one person can't cover two classes in the same period. Pick someone else for ${where}.`
    : `${who} was just assigned to cover period ${c.periodNumber} on ${c.date} by another request. Pick someone else for ${where}.`;
}

export async function loadUnavailability(
  db: Firestore,
  collegeId: string,
  fromISO: string,
  toISO: string,
  opts: { excludeRequestId?: string; excludeAdjustmentId?: string } = {}
): Promise<Unavailability> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [leaveSnap, adjSnap] = await Promise.all([
    collegeRef.collection("leaveRequests").where("status", "in", [...LIVE_LEAVE_STATUSES]).get(),
    collegeRef.collection("staffAdjustments").where("status", "==", "ACTIVE").get(),
  ]);

  const leaves: LiveLeave[] = [];
  for (const doc of leaveSnap.docs) {
    if (doc.id === opts.excludeRequestId) continue;
    const r = doc.data() as LeaveRequest;
    const from = toISODate(r.fromDate);
    const to = toISODate(r.toDate);
    if (!from || !to || to < fromISO || from > toISO) continue;
    leaves.push({
      requestId: doc.id, uid: r.uid, fromISO: from, toISO: to,
      // A proposal awaiting acceptance still reserves the slot.
      substitutions: [...(r.periodSubstitutions ?? []), ...(r.pendingPeriodSubstitutions ?? [])],
    });
  }

  const adjustments: (StaffAdjustment & { id: string })[] = [];
  for (const doc of adjSnap.docs) {
    if (doc.id === opts.excludeAdjustmentId) continue;
    const a = { id: doc.id, ...doc.data() } as StaffAdjustment & { id: string };
    if (a.toDate < fromISO || a.fromDate > toISO) continue;
    adjustments.push(a);
  }

  const covering = new Set<string>();
  const addCovering = (p: PeriodSubstitution) => covering.add(`${p.substituteFacultyId}|${p.date}|${p.periodNumber}`);
  for (const l of leaves) l.substitutions.forEach(addCovering);
  for (const a of adjustments) (a.periodSubstitutions ?? []).forEach(addCovering);

  return {
    isUnavailableOn(uid, dateISO) {
      return leaves.some((l) => l.uid === uid && l.fromISO <= dateISO && dateISO <= l.toISO)
        || adjustments.some((a) => a.subjectUid === uid && a.fromDate <= dateISO && dateISO <= a.toDate);
    },
    isCoveringAt(facultyId, dateISO, periodNumber) {
      return covering.has(`${facultyId}|${dateISO}|${periodNumber}`);
    },
    unavailableUidsBetween(from, to) {
      const out = new Set<string>();
      for (const l of leaves) if (l.toISO >= from && l.fromISO <= to) out.add(l.uid);
      for (const a of adjustments) if (a.toDate >= from && a.fromDate <= to) out.add(a.subjectUid);
      return out;
    },
    coveringFacultyIdsBetween(from, to) {
      const out = new Set<string>();
      for (const l of leaves) {
        if (l.toISO < from || l.fromISO > to) continue;
        for (const p of l.substitutions) out.add(p.substituteFacultyId);
      }
      for (const a of adjustments) {
        if (a.toDate < from || a.fromDate > to) continue;
        for (const p of a.periodSubstitutions ?? []) out.add(p.substituteFacultyId);
      }
      return out;
    },
  };
}
