import type { UserRole } from "@/types/core";
import type { LeaveApproverStage, LeaveRequestStatus } from "@/types/leave";

export type LeaveApprovalRouting = Partial<Record<UserRole, LeaveApproverStage>>;

// Every role that can submit a leave request (see the requireCollegeMember
// list in api/leave/applications/route.ts POST), in the order the Settings
// card lists them. COLLEGE_ADMIN and DEPARTMENT_OFFICE are absent on purpose:
// both are normalized to PRINCIPAL / HOD before a session role is read.
export const ROUTABLE_REQUESTER_ROLES: UserRole[] = [
  "PANEL_MEMBER", "HOD", "VICE_PRINCIPAL", "PRINCIPAL",
  "COLLEGE_OFFICE", "COLLEGE_STAFF", "ACCOUNTS", "FINANCE", "ACADEMICS", "IQAC_COORDINATOR",
  "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT",
];

// A Principal's own leave has no one above them inside the college, so it
// always goes to Management. An HOD / Vice Principal can't sit at the HOD tier
// (that would be approving their own leave), so those two choose between the
// Principal tier and Management. Everyone else may pick any tier - the HOD tier
// only takes effect for someone who actually has a department (see
// resolveApproverStage).
export function allowedStagesForRole(role: UserRole): LeaveApproverStage[] {
  if (role === "PRINCIPAL") return ["MANAGEMENT"];
  if (role === "HOD" || role === "VICE_PRINCIPAL") return ["PRINCIPAL", "MANAGEMENT"];
  return ["HOD", "PRINCIPAL", "MANAGEMENT"];
}

// What each role did before this was configurable - kept as the default so a
// college that never touches the setting sees no change.
export function defaultApproverStage(role: UserRole): LeaveApproverStage {
  if (role === "PRINCIPAL") return "MANAGEMENT";
  if (role === "PANEL_MEMBER" || role === "COLLEGE_STAFF") return "HOD";
  return "PRINCIPAL";
}

export function resolveApproverStage(
  routing: LeaveApprovalRouting | undefined,
  role: string,
  hasDepartment: boolean
): LeaveApproverStage {
  const r = role as UserRole;
  const allowed = allowedStagesForRole(r);
  const configured = routing?.[r];
  let stage = configured && allowed.includes(configured) ? configured : defaultApproverStage(r);
  // A department's HOD can only decide a request that belongs to their
  // department (the PENDING_HOD guard in applications/[id]/route.ts), so a
  // requester with no department would sit there with nobody able to act.
  if (stage === "HOD" && !hasDepartment) stage = "PRINCIPAL";
  return stage;
}

export function approverStageToStatus(stage: LeaveApproverStage): Extract<LeaveRequestStatus, "PENDING_HOD" | "PENDING_PRINCIPAL" | "PENDING_MANAGEMENT"> {
  return stage === "HOD" ? "PENDING_HOD" : stage === "MANAGEMENT" ? "PENDING_MANAGEMENT" : "PENDING_PRINCIPAL";
}

// Validates a client-submitted routing map, dropping anything that isn't a
// known role/stage pair the role is actually allowed to use.
export function sanitizeLeaveApprovalRouting(input: unknown): { ok: true; routing: LeaveApprovalRouting } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "leaveApprovalRouting must be an object" };
  const routing: LeaveApprovalRouting = {};
  for (const [role, stage] of Object.entries(input as Record<string, unknown>)) {
    if (!ROUTABLE_REQUESTER_ROLES.includes(role as UserRole)) return { ok: false, error: `${role} can't have a leave routing` };
    if (stage !== "HOD" && stage !== "PRINCIPAL" && stage !== "MANAGEMENT") return { ok: false, error: `Invalid approver for ${role}` };
    if (!allowedStagesForRole(role as UserRole).includes(stage)) return { ok: false, error: `${role} can't be routed to ${stage}` };
    routing[role as UserRole] = stage;
  }
  return { ok: true, routing };
}
