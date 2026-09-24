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
  };
}
