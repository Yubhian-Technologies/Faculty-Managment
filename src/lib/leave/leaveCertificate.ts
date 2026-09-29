import type { LeaveRequest } from "@/types/leave";

// The post-leave certificate rule, in one pure place - the counterpart of
// odProof.ts for SL and SCL. Deliberately much smaller than OD's: this is
// record-keeping, never a pay rule, so there is no grace window, no
// "overdue", and no Loss-of-Pay derivation - for EITHER leave type. Gated
// purely on `leaveTypeCode` at read time - unlike OD proof there's no
// approval-time stamp to grandfather old requests out of, because a missing
// certificate has no consequence to grandfather anyone away from.
//
// SL's certificate is entirely optional. SCL's is "required" in the sense
// that an approver's queue chases it (see `required` below and the
// scl-missing-certificate scope in applications/route.ts) - but it still
// never blocks a future application or affects pay, exactly like SL's. One
// `LeaveRequest` document is always exactly one leave type, so a single field
// group (`certificate*` on LeaveRequest) safely serves both.
//
// Same two load-bearing properties as odProof.ts:
//  - PURE and lazily evaluated - nothing here is ever persisted as a verdict.
//  - CLIENT-SAFE - LeaveHistoryRow is a "use client" component and imports
//    this directly, so: `import type` only, no firebase-admin.

export type LeaveCertificateState =
  /** Not an approved SL or SCL request. */
  | "NOT_APPLICABLE"
  /** The leave period hasn't ended yet - nothing to attach so far. */
  | "NOT_DUE"
  /** Period over, nothing uploaded. */
  | "AWAITING_UPLOAD"
  /** Rejected - fix it and resubmit. */
  | "REJECTED_REUPLOAD"
  /** Uploaded; the approver hasn't looked at it yet. */
  | "PENDING_VERIFICATION"
  /** Verified. */
  | "VERIFIED";

export interface LeaveCertificateEvaluation {
  state: LeaveCertificateState;
  /** False for anything outside the certificate regime - see NOT_APPLICABLE. */
  applicable: boolean;
  /** True for SCL - drives "required" vs "optional" copy and the approver's
   *  chase queue. Always false when `applicable` is false. */
  required: boolean;
  /** Inclusive end of the leave period (23:59:59.999 of toDate). */
  periodEnd: Date | null;
  /** The requester may submit (or replace) a certificate right now. */
  canUpload: boolean;
  /** Sitting in the approver's queue. */
  awaitingVerification: boolean;
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

type LeaveCertificateInput = Pick<LeaveRequest, "leaveTypeCode" | "status" | "toDate" | "certificateStatus">;

const NOT_APPLICABLE: LeaveCertificateEvaluation = {
  state: "NOT_APPLICABLE",
  applicable: false,
  required: false,
  periodEnd: null,
  canUpload: false,
  awaitingVerification: false,
};

/** Where one request stands in the certificate regime, as of `asOf`. */
export function evaluateLeaveCertificate(
  request: LeaveCertificateInput,
  asOf: Date = new Date()
): LeaveCertificateEvaluation {
  const applicable =
    (request.leaveTypeCode === "SL" || request.leaveTypeCode === "SCL") && request.status === "APPROVED";
  if (!applicable) return NOT_APPLICABLE;

  const to = toDate(request.toDate);
  if (!to) return NOT_APPLICABLE;

  const required = request.leaveTypeCode === "SCL";
  const periodEnd = endOfDay(to);
  const periodOver = asOf > periodEnd;

  const certStatus = request.certificateStatus;
  // Replacing a certificate stays open indefinitely (no deadline exists to
  // close it), except once verified - same "can't touch a verified one"
  // contract as OD proof.
  const canUpload = periodOver && certStatus !== "VERIFIED";
  const awaitingVerification = certStatus === "PENDING_VERIFICATION";

  let state: LeaveCertificateState;
  if (certStatus === "VERIFIED") state = "VERIFIED";
  else if (certStatus === "PENDING_VERIFICATION") state = "PENDING_VERIFICATION";
  else if (!periodOver) state = "NOT_DUE";
  else if (certStatus === "REJECTED") state = "REJECTED_REUPLOAD";
  else state = "AWAITING_UPLOAD";

  return { state, applicable: true, required, periodEnd, canUpload, awaitingVerification };
}
