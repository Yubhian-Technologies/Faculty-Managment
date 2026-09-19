import type { Firestore } from "firebase-admin/firestore";
import type { UserRole } from "@/types/core";
import { loadUnavailability } from "@/lib/leave/availability";
import { expandStoredRoles, type PoolMember } from "@/lib/leave/handoverPool";

// The Adjustments module: who may adjust whom. A manager arranges cover for
// someone BELOW them who has other work on a date/range:
//
//   Principal      -> Vice Principal, Dean, HODs
//   Vice Principal -> HODs, Dean
//   HOD            -> faculty and supporting staff of their own department(s)
//   College Office -> supporting staff
//
// Cover always comes from the subject's own tier (a Vice Principal's duties go
// to another Vice Principal / the Dean, a supporting-staff member's to another
// supporting-staff member) - never across the teaching / non-teaching line.
export const ADJUSTMENT_MANAGER_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE"] as const;
export type AdjustmentManagerRole = (typeof ADJUSTMENT_MANAGER_ROLES)[number];

export function isAdjustmentManager(role: string): role is AdjustmentManagerRole {
  return (ADJUSTMENT_MANAGER_ROLES as readonly string[]).includes(role);
}

export function adjustableRoles(managerRole: AdjustmentManagerRole): UserRole[] {
  switch (managerRole) {
    case "PRINCIPAL": return ["VICE_PRINCIPAL", "DEAN", "HOD"];
    case "VICE_PRINCIPAL": return ["HOD", "DEAN"];
    case "HOD": return ["PANEL_MEMBER", "COLLEGE_STAFF"];
    case "COLLEGE_OFFICE": return ["COLLEGE_STAFF"];
  }
}

// Normalizes a stored role first - a users doc may still say DEPARTMENT_OFFICE
// or COLLEGE_ADMIN (see types/core.ts).
function normalizeStoredRole(role: string): string {
  if (role === "DEPARTMENT_OFFICE") return "HOD";
  if (role === "COLLEGE_ADMIN") return "PRINCIPAL";
  return role;
}

export function coverRoles(subjectRole: string): UserRole[] {
  switch (normalizeStoredRole(subjectRole)) {
    case "VICE_PRINCIPAL":
    case "DEAN": return ["VICE_PRINCIPAL", "DEAN"];
    case "HOD": return ["HOD"];
    case "PANEL_MEMBER": return ["PANEL_MEMBER"];
    default: return ["COLLEGE_STAFF"];
  }
}

export interface AdjustmentManager {
  uid: string;
  role: AdjustmentManagerRole;
}

// Only an HOD is fenced to a department; everyone else's scope is the college.
export async function resolveManagerDepartments(db: Firestore, collegeId: string, manager: AdjustmentManager): Promise<string[] | null> {
  if (manager.role !== "HOD") return null;
  const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(manager.uid).get();
  const u = snap.data() as { department?: string; departments?: string[] } | undefined;
  const names = u?.departments?.length ? u.departments : u?.department ? [u.department] : [];
  return names.filter(Boolean);
}

async function listUsersWithRoles(
  db: Firestore,
  collegeId: string,
  roles: UserRole[],
  departments: string[] | null
): Promise<(PoolMember & { departments: string[] })[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("users")
    .where("role", "in", expandStoredRoles(roles).slice(0, 30)).get();
  return snap.docs
    .map((d) => {
      const u = d.data() as { name?: string; role?: string; department?: string; departments?: string[]; isActive?: boolean };
      return { uid: d.id, name: u.name ?? "Unknown", role: normalizeStoredRole(u.role ?? ""), department: u.department ?? "", departments: u.departments ?? [], isActive: u.isActive };
    })
    .filter((u) => u.isActive !== false)
    .filter((u) => !departments || departments.some((dep) => u.department === dep || u.departments.includes(dep)))
    .map(({ uid, name, role, department, departments: deps }) => ({ uid, name, role, department, departments: deps }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAdjustableSubjects(db: Firestore, collegeId: string, manager: AdjustmentManager): Promise<PoolMember[]> {
  const departments = await resolveManagerDepartments(db, collegeId, manager);
  if (departments && departments.length === 0) return [];
  const users = await listUsersWithRoles(db, collegeId, adjustableRoles(manager.role), departments);
  return users.filter((u) => u.uid !== manager.uid).map(({ uid, name, role, department }) => ({ uid, name, role, department }));
}

// People who can take over `subject`'s other duties across [fromISO, toISO]:
// their own tier, within the manager's scope, not the subject, and not on
// leave / already tied up in the range.
export async function listCoverCandidates(
  db: Firestore,
  collegeId: string,
  manager: AdjustmentManager,
  subject: { uid: string; role: string },
  range: { fromISO: string; toISO: string },
  opts: { excludeAdjustmentId?: string } = {}
): Promise<PoolMember[]> {
  const departments = await resolveManagerDepartments(db, collegeId, manager);
  if (departments && departments.length === 0) return [];
  const [users, unavailability] = await Promise.all([
    listUsersWithRoles(db, collegeId, coverRoles(subject.role), departments),
    loadUnavailability(db, collegeId, range.fromISO, range.toISO, { excludeAdjustmentId: opts.excludeAdjustmentId }),
  ]);
  const busy = unavailability.unavailableUidsBetween(range.fromISO, range.toISO);
  return users
    .filter((u) => u.uid !== subject.uid && u.uid !== manager.uid && !busy.has(u.uid))
    .map(({ uid, name, role, department }) => ({ uid, name, role, department }));
}
