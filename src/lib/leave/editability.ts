import type { LeaveRequest, LeaveRequestStatus } from "@/types/leave";

const TERMINAL_STATUSES: ReadonlySet<LeaveRequestStatus> = new Set(["APPROVED", "REJECTED", "CANCELLED"]);

// A request is still editable by its own requester exactly while no approver
// in its chain has acted yet - covers PENDING_ACCEPTANCE (nobody named has
// even accepted a substitute/handover pick yet) and whichever single
// PENDING_* stage it's currently sitting in before THAT stage's approver
// decides. No routing recomputation needed: hodAction/principalAction/
// managementAction (types/leave.ts) are only ever set once that tier
// actually decides, and PENDING_VICE_PRINCIPAL's decision is recorded under
// principalAction too (see applications/[id]/route.ts) - so "none of these
// three are set" is equivalent to "still awaiting its first decision"
// regardless of which stage the request started at.
export function isLeaveRequestEditable(request: Pick<LeaveRequest, "status" | "hodAction" | "principalAction" | "managementAction">): boolean {
  if (TERMINAL_STATUSES.has(request.status)) return false;
  return !request.hodAction && !request.principalAction && !request.managementAction;
}
