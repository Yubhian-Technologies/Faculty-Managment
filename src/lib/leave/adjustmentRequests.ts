import type { Firestore } from "firebase-admin/firestore";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { notify } from "@/lib/notify";
import type { AdjustmentPeriodStatus, AdjustmentRequest, AdjustmentResponseStatus, LeaveRequest, PeriodSubstitution } from "@/types/leave";

// Builds one PENDING AdjustmentRequest per distinct substitute named in
// `periodSubstitutions` - bundling every period they're covering into a
// single accept/decline notification, never one per period (they can still
// accept/decline individual periods within that one entry - see
// deriveSubstituteStatus below) - plus one more for the optional handover/
// point-of-contact pick, if any. A substitute who's also the handover pick
// only gets the one (SUBSTITUTE) entry, not a duplicate.
export async function buildAdjustmentRequests(
  db: Firestore,
  collegeId: string,
  periodSubstitutions: PeriodSubstitution[] | undefined,
  handover: { uid: string; name: string } | null
): Promise<AdjustmentRequest[]> {
  const out: AdjustmentRequest[] = [];
  const seenUids = new Set<string>();
  if (periodSubstitutions?.length) {
    const periodsByFacultyId = new Map<string, { name: string; periods: AdjustmentPeriodStatus[] }>();
    for (const p of periodSubstitutions) {
      const entry = periodsByFacultyId.get(p.substituteFacultyId) ?? { name: p.substituteFacultyName, periods: [] };
      entry.periods.push({ date: p.date, timetableSlotId: p.timetableSlotId, status: "PENDING" });
      periodsByFacultyId.set(p.substituteFacultyId, entry);
    }
    for (const [facultyId, { name, periods }] of periodsByFacultyId) {
      const uid = await resolveLoginUidForFacultyMember(db, collegeId, facultyId);
      if (!uid || uid === facultyId || seenUids.has(uid)) continue; // not provisioned with a login yet - nothing to ask
      seenUids.add(uid);
      out.push({ kind: "SUBSTITUTE", assigneeUid: uid, assigneeName: name, assigneeFacultyId: facultyId, periods, status: "PENDING" });
    }
  }
  if (handover && !seenUids.has(handover.uid)) {
    out.push({ kind: "HANDOVER", assigneeUid: handover.uid, assigneeName: handover.name, status: "PENDING" });
  }
  return out;
}

// PENDING while any period is still undecided; ACCEPTED once every period is
// ACCEPTED; DECLINED once every period is settled but at least one is
// DECLINED (that's what still blocks the request - see allAdjustmentsAccepted).
export function deriveSubstituteStatus(periods: AdjustmentPeriodStatus[]): AdjustmentResponseStatus {
  if (periods.some((p) => p.status === "PENDING")) return "PENDING";
  return periods.some((p) => p.status === "DECLINED") ? "DECLINED" : "ACCEPTED";
}

export function allAdjustmentsAccepted(list: AdjustmentRequest[] | undefined): boolean {
  return !list?.length || list.every((a) => a.status === "ACCEPTED");
}

// Adds a fresh set of PENDING periods for one substitute into an existing
// adjustmentRequests list - merged into that person's own existing SUBSTITUTE
// entry if they already have one on this leave (so they still only ever see
// one combined request, never a second one for the same leave), otherwise
// appended as a new entry. Used by PROPOSE_COVERAGE (a HOD/Principal naming a
// new/changed substitute) and REVISE_ADJUSTMENT (a requester re-picking after
// a decline).
export function mergeSubstituteEntry(
  list: AdjustmentRequest[],
  assignee: { uid: string; name: string; facultyId: string },
  newPeriods: AdjustmentPeriodStatus[]
): AdjustmentRequest[] {
  const idx = list.findIndex((a) => a.assigneeUid === assignee.uid && a.kind === "SUBSTITUTE");
  if (idx === -1) {
    return [...list, {
      kind: "SUBSTITUTE", assigneeUid: assignee.uid, assigneeName: assignee.name,
      assigneeFacultyId: assignee.facultyId, periods: newPeriods, status: "PENDING",
    }];
  }
  const existing = list[idx];
  const existingKeys = new Set((existing.periods ?? []).map((p) => `${p.date}|${p.timetableSlotId}`));
  const periods = [...(existing.periods ?? []), ...newPeriods.filter((p) => !existingKeys.has(`${p.date}|${p.timetableSlotId}`))];
  const out = [...list];
  out[idx] = { ...existing, periods, status: deriveSubstituteStatus(periods) };
  return out;
}

// Same routing rule applications/route.ts POST already uses to pick a fresh
// request's first real approval stage - factored out so both that route and
// the accept/decline endpoint (which runs under the ASSIGNEE's session, not
// the requester's) resolve it identically.
export function resolvePostAcceptanceStatus(
  role: string,
  reportsToHod: boolean
): "PENDING_MANAGEMENT" | "PENDING_HOD" | "PENDING_PRINCIPAL" {
  if (role === "PRINCIPAL") return "PENDING_MANAGEMENT";
  return reportsToHod ? "PENDING_HOD" : "PENDING_PRINCIPAL";
}

// Notifies every still-PENDING assignee that they've been asked to
// accept/decline - called once at submission (applications/route.ts POST)
// and again after a requester revises a DECLINED pick.
export async function notifyAdjustmentAssignees(
  db: Firestore,
  collegeId: string,
  req: Pick<LeaveRequest, "employeeName" | "totalDays" | "adjustmentRequests">
): Promise<void> {
  for (const a of req.adjustmentRequests ?? []) {
    if (a.status !== "PENDING") continue;
    const what = a.kind === "SUBSTITUTE" ? "cover their class(es)" : "be their point of contact";
    await notify(
      db, collegeId, a.assigneeUid, "ADJUSTMENT_REQUESTED", "Adjustment Request",
      `${req.employeeName} has asked you to ${what} while they're on leave (${req.totalDays} day(s)). Please accept or decline.`,
      "/leave/adjustments"
    );
  }
}
