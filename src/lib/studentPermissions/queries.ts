import type { Firestore } from "firebase-admin/firestore";
import { ApprovalError } from "@/lib/approvals";
import type { ListOptions } from "@/lib/approvals";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import { allDepartmentNames, editableDepartmentsOf, headsDepartment } from "./directory";
import { FACULTY_RAISER_ROLES, hasAnyRole, oversees } from "./roles";
import { PERMISSION_KIND, type ActingUser, type PermissionPayload, type PermissionRequest } from "./types";
import { store } from "./wiring";

// Use-cases that only READ requests: the inbox, my requests, oversight lists, a
// single request, and who may see what.

/** "<stage>|<scope>" inbox keys for everything this login can currently decide. */
export async function inboxKeys(db: Firestore, user: ActingUser): Promise<string[]> {
  const keys: string[] = [];
  if (user.roles.includes("HOD")) for (const d of await editableDepartmentsOf(db, user)) keys.push(`HOD|${d}`);
  if (user.roles.includes("VICE_PRINCIPAL")) keys.push("VICE_PRINCIPAL|*");
  if (user.roles.includes("PRINCIPAL")) keys.push("PRINCIPAL|*");
  // Any teaching login may be a class incharge; the key is the incharge id recorded on the request.
  if (hasAnyRole(user.roles, FACULTY_RAISER_ROLES)) {
    for (const id of await getFacultyIdCandidates(db, user.collegeId, user.uid)) keys.push(`CLASS_INCHARGE|${id}`);
  }
  return Array.from(new Set(keys));
}

/** What waits for this login's decision. The Principal and Vice Principal see (and may decide) every pending request. */
export const listInbox = async (db: Firestore, user: ActingUser, opts?: ListOptions) =>
  oversees(user.roles)
    // Newest 300 of any status, then the pending ones: asking for only `limit` first would hide an old pending request behind newer finished ones.
    ? (await listForOversight(db, user, { ...opts, limit: 300 })).filter((r) => r.status === "PENDING").slice(0, opts?.limit ?? 50)
    : store(db).listByPendingKeys<PermissionPayload>(user.collegeId, PERMISSION_KIND, await inboxKeys(db, user), opts);

/** Requests this login raised, plus (for a student) those raised for them by faculty. */
export async function listMine(db: Firestore, user: ActingUser, opts?: ListOptions): Promise<PermissionRequest[]> {
  const [raised, covering] = await Promise.all([
    store(db).listByRequester<PermissionPayload>(user.collegeId, PERMISSION_KIND, user.uid, opts),
    store(db).listByPayloadArray<PermissionPayload>(user.collegeId, PERMISSION_KIND, "studentUids", user.uid, opts),
  ]);
  const seen = new Set<string>();
  return [...raised, ...covering].filter((r) => !seen.has(r.id) && !!seen.add(r.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, opts?.limit ?? 100);
}

/** Everything in the departments this login oversees (HOD: theirs; Vice Principal / Principal: all). */
export async function listForOversight(db: Firestore, user: ActingUser, opts?: ListOptions): Promise<PermissionRequest[]> {
  let scopes: string[] = [];
  if (oversees(user.roles)) scopes = await allDepartmentNames(db, user.collegeId);
  else if (user.roles.includes("HOD")) scopes = await editableDepartmentsOf(db, user);
  return store(db).listByScope<PermissionPayload>(user.collegeId, PERMISSION_KIND, scopes, opts);
}

/** Approved requests covering a specific section (for Class Representatives and Section views). */
export async function listSectionApproved(
  db: Firestore, user: ActingUser, department: string, section: string, year: number, opts?: ListOptions
): Promise<PermissionRequest[]> {
  const approved = await store(db).listByScope<PermissionPayload>(user.collegeId, PERMISSION_KIND, [department], opts);
  return approved.filter((r) => r.status === "APPROVED" && r.payload.students.some((s) => s.section === section && s.year === year));
}

/** May this login see this request? Requester, a covered student, the department's HOD, the Vice Principal / Principal, or its class incharge. */
export async function canView(db: Firestore, user: ActingUser, req: PermissionRequest): Promise<boolean> {
  if (req.requesterUid === user.uid || req.payload.studentUids.includes(user.uid)) return true;
  if (oversees(user.roles)) return true;
  if (await headsDepartment(db, user, req.scope)) return true;
  if (req.payload.inchargeUid) return (await getFacultyIdCandidates(db, user.collegeId, user.uid)).includes(req.payload.inchargeUid);
  return false;
}

export async function getRequest(db: Firestore, user: ActingUser, id: string): Promise<PermissionRequest> {
  const req = await store(db).get<PermissionPayload>(user.collegeId, id);
  // Same answer for "doesn't exist" and "not yours" so ids can't be probed.
  if (!req || req.kind !== PERMISSION_KIND || !(await canView(db, user, req))) throw new ApprovalError("NOT_FOUND", "Request not found", 404);
  return req;
}
