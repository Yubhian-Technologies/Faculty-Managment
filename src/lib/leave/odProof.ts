import type { LeaveRequest } from "@/types/leave";

// The On Duty proof rule, in one pure place.
//
// On Duty is the only leave type with no evidence trail: it's
// `rules.unlimited`, so no balance doc is ever created, splitLeaveDays never
// runs, and lopDays stays 0 - an OD is implicitly fully paid and nothing ever
// asks what the duty actually was. So an approved OD now has to be EVIDENCED:
// the requester uploads a certificate/letter once the period ends, their
// approver verifies it, and days left unproven past the grace window stop
// being paid (see unprovenODLopDays, consumed by monthlySummary.ts).
//
// Two properties of this module are load-bearing:
//
//  - It is PURE and lazily evaluated. This repo has no scheduler, so nothing
//    can ever write "this OD went unproven" at the moment the window closes.
//    The state is derived from the request's own dates every time it's read,
//    exactly the way isCancellable() decides against toDate. That's also what
//    makes a late-but-verified proof retroactively clear the Loss of Pay, for
//    free - there's no stored verdict to go back and correct.
//  - It is CLIENT-SAFE. LeaveHistoryRow is a "use client" component and
//    imports evaluateODProof to render its badge, so: `import type` only, no
//    firebase-admin, and a local toDate (copied from monthlySummary.ts, which
//    carries its own for the same reason) that handles both an admin Timestamp
//    and the {_seconds} shape the same value takes once it has been through
//    JSON on the way to the browser.

/**
 * Days after the OD period ends within which proof must be uploaded and
 * verified. Past this, unproven days start counting as Loss of Pay.
 */
export const OD_PROOF_GRACE_DAYS = 7;

export type ODProofState =
  /** Not an OD, not approved, or approved before this feature existed. */
  | "NOT_APPLICABLE"
  /** The OD period hasn't ended yet - nothing to prove so far. */
  | "NOT_DUE"
  /** Period over, nothing uploaded, still inside the grace window. */
  | "AWAITING_UPLOAD"
  /** Rejected and still inside the grace window - fix it and resubmit. */
  | "REJECTED_REUPLOAD"
  /** Uploaded; the approver hasn't looked at it yet. */
  | "PENDING_VERIFICATION"
  /** Verified - these days are paid. */
  | "VERIFIED"
  /** Grace expired with no verified proof - these days are Loss of Pay. */
  | "OVERDUE";

export interface ODProofEvaluation {
  state: ODProofState;
  /** False for anything outside the OD proof regime - see NOT_APPLICABLE. */
  applicable: boolean;
  /** Inclusive end of the OD period (23:59:59.999 of toDate). */
  periodEnd: Date | null;
  /** periodEnd + OD_PROOF_GRACE_DAYS, end of day. */
  proofDueBy: Date | null;
  /** The requester may submit (or replace) proof right now. */
  canUpload: boolean;
  /** Sitting in the approver's queue. */
  awaitingVerification: boolean;
  /** THE pay rule: true means this request's days are Loss of Pay as of asOf. */
  isUnprovenLop: boolean;
}

/** Handles an admin Timestamp and the {_seconds} shape it becomes over JSON. */
function toDate(v: unknown): Date | null {
  if (!v) return null;
  const t = v as { toDate?: () => Date; _seconds?: number };
  if (typeof t.toDate === "function") return t.toDate();
  if (typeof t._seconds === "number") return new Date(t._seconds * 1000);
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

type ODProofInput = Pick<
  LeaveRequest,
  "leaveTypeCode" | "status" | "toDate" | "odProofRequired" | "odProofStatus"
>;

const NOT_APPLICABLE: ODProofEvaluation = {
  state: "NOT_APPLICABLE",
  applicable: false,
  periodEnd: null,
  proofDueBy: null,
  canUpload: false,
  awaitingVerification: false,
  isUnprovenLop: false,
};

/**
 * Where one request stands in the OD proof regime, as of `asOf`.
 *
 * Deliberately keyed on the literal `leaveTypeCode === "OD"` rather than the
 * leave type's `rules.unlimited` flag, which every OTHER guard in the codebase
 * uses: SH (Summer Vacation) shares that flag, and sweeping a whole vacation
 * into Loss of Pay over a missing certificate would be a serious bug.
 */
export function evaluateODProof(
  request: ODProofInput,
  asOf: Date = new Date(),
  graceDays: number = OD_PROOF_GRACE_DAYS
): ODProofEvaluation {
  const applicable =
    request.leaveTypeCode === "OD" &&
    request.status === "APPROVED" &&
    // The opt-in stamp, not a type test - this is what keeps every OD approved
    // before the feature shipped permanently exempt (see the field's doc).
    request.odProofRequired === true;
  if (!applicable) return NOT_APPLICABLE;

  const to = toDate(request.toDate);
  if (!to) return NOT_APPLICABLE;

  // Same end-of-day construction isCancellable() uses, so "Cancel" and "Upload
  // proof" are exact complements: one disappears the instant the other appears.
  const periodEnd = endOfDay(to);
  const proofDueBy = endOfDay(
    new Date(to.getFullYear(), to.getMonth(), to.getDate() + graceDays)
  );

  const proofStatus = request.odProofStatus;
  const periodOver = asOf > periodEnd;
  const graceExpired = asOf > proofDueBy;

  // Replacing a proof stays open even after the deadline: the register is
  // computed lazily, so a late proof that gets verified retroactively removes
  // the Loss of Pay. Refusing a late upload would strand the requester with no
  // way to fix it.
  const canUpload = periodOver && proofStatus !== "VERIFIED";
  const awaitingVerification = proofStatus === "PENDING_VERIFICATION";

  // Uploaded-but-unreviewed suspends Loss of Pay past the deadline: the
  // requester did their part on time and shouldn't lose pay for an approver's
  // inaction. The loophole that opens (upload anything, never get reviewed) is
  // bounded - a rejection at any later date flips this straight to LOP, and the
  // approver has both a queue entry and a notification telling them to look.
  const isUnprovenLop =
    graceExpired && proofStatus !== "VERIFIED" && proofStatus !== "PENDING_VERIFICATION";

  let state: ODProofState;
  if (proofStatus === "VERIFIED") state = "VERIFIED";
  else if (proofStatus === "PENDING_VERIFICATION") state = "PENDING_VERIFICATION";
  else if (!periodOver) state = "NOT_DUE";
  else if (isUnprovenLop) state = "OVERDUE";
  else if (proofStatus === "REJECTED") state = "REJECTED_REUPLOAD";
  else state = "AWAITING_UPLOAD";

  return {
    state,
    applicable: true,
    periodEnd,
    proofDueBy,
    canUpload,
    awaitingVerification,
    isUnprovenLop,
  };
}

/**
 * Loss of Pay days contributed by unproven On Duty requests within some
 * window - the OD half of monthlySummary's `lopDays`.
 *
 * OD carries no stored `lopDays` of its own (it's `rules.unlimited`, so
 * splitLeaveDays never runs and no balance is ever drawn), so an unproven OD is
 * Loss of Pay for its WHOLE span within the window - the same shape
 * `otherLopDays` already uses for an unpaid "Other" request.
 *
 * `daysInWindow` is passed in rather than reading `totalDays` so the window
 * math stays with the caller and the OD policy stays here - and it gets
 * half-day OD right for free, since OD is in HALF_DAY_ELIGIBLE_TYPES and the
 * caller's helper already returns 0.5 for one.
 */
export function unprovenODLopDays(
  approved: LeaveRequest[],
  daysInWindow: (request: LeaveRequest) => number,
  asOf: Date = new Date()
): number {
  return approved
    .filter((r) => evaluateODProof(r, asOf).isUnprovenLop)
    .reduce((sum, r) => sum + daysInWindow(r), 0);
}
