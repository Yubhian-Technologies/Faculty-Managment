import { ApprovalError } from "@/lib/approvals";
import type { Firestore } from "firebase-admin/firestore";
import { canView } from "./queries";
import { isStudentOnly } from "./roles";
import { PERMISSION_KIND, type ActingUser, type PermissionPayload } from "./types";
import { ctxOf, engine, store } from "./wiring";

// Application service for student permissions: the use-cases the API routes call.
// Routes stay thin (authenticate, parse, call one of these, shape the response).
// The use-cases live next to this file, one concern each, and are re-exported here
// so callers have a single import:
//   create.ts        raise a request
//   queries.ts       inbox, my requests, oversight, one request, who may see it
//   configService.ts the routing configuration
//   directory.ts     what we ask OTHER modules (students, sections, departments)
// Deciding / withdrawing are thin calls into the approvals engine, defined below.

export type { ActingUser, PermissionRequest } from "./types";
export { FACULTY_RAISER_ROLES } from "./roles";
export { loadStudentByUid } from "./directory";
export { createStudentRequest, createFacultyRequests } from "./create";
export { inboxKeys, listInbox, listMine, listForOversight, listSectionApproved, canView, getRequest } from "./queries";
export { describeEditor, readConfig, writeConfig } from "./configService";

// ── deciding / withdrawing ───────────────────────────────────────────────────

/** Whether an approval completes the whole request is the kind's policy (see studentPermissionKind.completesAllOnApprove). */
export const decide = (db: Firestore, user: ActingUser, id: string, decision: "APPROVE" | "REJECT", remark?: string) =>
  engine(db).decide(ctxOf(db, user), { collegeId: user.collegeId, id, actor: { uid: user.uid, name: user.name }, decision, remark });

export const cancelRequest = (db: Firestore, user: ActingUser, id: string, remark?: string) =>
  engine(db).cancel(ctxOf(db, user), { collegeId: user.collegeId, id, actor: { uid: user.uid, name: user.name }, remark });

export const revokeRequest = (db: Firestore, user: ActingUser, id: string, remark: string) =>
  engine(db).revoke(ctxOf(db, user), { collegeId: user.collegeId, id, actor: { uid: user.uid, name: user.name }, remark });

/** Re-runs a failed after-approval step (e.g. updating already-marked sessions). Any approver may trigger it. */
export async function retryEffects(db: Firestore, user: ActingUser, id: string) {
  const req = await store(db).get<PermissionPayload>(user.collegeId, id);
  if (!req || req.kind !== PERMISSION_KIND) throw new ApprovalError("NOT_FOUND", "Request not found", 404);
  // A student (covered by a faculty-raised request) can see it but is never an approver.
  if (!(await canView(db, user, req)) || req.requesterUid === user.uid || isStudentOnly(user.roles)) throw new ApprovalError("FORBIDDEN", "You can't do that", 403);
  return engine(db).retryEffects(ctxOf(db, user), { collegeId: user.collegeId, id });
}
