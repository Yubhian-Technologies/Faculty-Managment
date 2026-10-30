import type { Firestore } from "firebase-admin/firestore";
import { ApprovalError, applyConfigEdit } from "@/lib/approvals";
import type { ConfigEditor } from "@/lib/approvals";
import { loadPermissionConfig, savePermissionConfig } from "./configStore";
import { editableDepartmentsOf } from "./directory";
import { clampLimits } from "./rules";
import { allowedStages, type ActingUser, type PermissionConfig } from "./types";

const isCollegeHead = (user: ActingUser) => user.roles.includes("PRINCIPAL") || user.roles.includes("VICE_PRINCIPAL"); // the Vice Principal edits like the Principal

// Use-cases for the routing configuration: who may edit it, and saving an edit.

/** Who the acting login is, for editing configuration: the Principal, or an HOD for their own departments. */
async function configEditor(db: Firestore, user: ActingUser): Promise<ConfigEditor> {
  if (isCollegeHead(user)) return { role: "PRINCIPAL" };
  if (user.roles.includes("HOD")) return { role: "HOD", departments: await editableDepartmentsOf(db, user) };
  throw new ApprovalError("FORBIDDEN", "Only the Principal, Vice Principal or an HOD can change this", 403);
}

/** What the acting login may edit, for the screen: everything (Principal), their own departments (HOD), or nothing. */
export async function describeEditor(db: Firestore, user: ActingUser): Promise<{ college: boolean; departments: string[] | "ALL" }> {
  if (isCollegeHead(user)) return { college: true, departments: "ALL" };
  if (user.roles.includes("HOD")) return { college: false, departments: await editableDepartmentsOf(db, user) };
  return { college: false, departments: [] };
}

/** The config as this login is allowed to see it (HODs see the college rules too, read-only). */
export const readConfig = (db: Firestore, user: ActingUser) => loadPermissionConfig(db, user.collegeId);

export async function writeConfig(db: Firestore, user: ActingUser, proposed: PermissionConfig): Promise<PermissionConfig> {
  const editor = await configEditor(db, user);
  const current = await loadPermissionConfig(db, user.collegeId);
  const next = applyConfigEdit(current, proposed, editor, allowedStages);
  // Keep limits in range, at college level and in every department override.
  if (next.college.limits) next.college = { ...next.college, limits: clampLimits(next.college.limits) };
  for (const [d, dc] of Object.entries(next.departments)) {
    if (dc.override?.limits) next.departments[d] = { ...dc, override: { ...dc.override, limits: clampLimits(dc.override.limits) } };
  }
  return savePermissionConfig(db, user.collegeId, next, user.name);
}
