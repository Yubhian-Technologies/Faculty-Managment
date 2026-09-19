import type { Firestore } from "firebase-admin/firestore";
import type { UserRole } from "@/types/core";
import { loadUnavailability } from "@/lib/leave/availability";

// Who a person may name as a handover / point-of-contact - or, for a manager,
// who they may adjust and who may cover for them (see the Adjustments module) -
// is decided by the role of whoever is asking, never just "same department".
// The old rule offered a department's teaching faculty to every requester, so a
// College Office / supporting-staff member (or the Principal) was handed a
// list of classroom teachers. Each role now draws from its own tier:
//
//   Faculty        -> other faculty in their department
//   HOD            -> faculty + supporting staff in their department
//   Principal      -> Vice Principal, Dean
//   Vice Principal -> HODs, Dean
//   Supporting staff (with a department)  -> supporting staff in that department
//   Supporting staff (no department) / College Office / every other
//   non-teaching role -> non-teaching staff (their own role, supporting staff,
//                        College Office) - never teaching faculty.
export interface PoolRule {
  roles: UserRole[];
  /** Only people in the asker's own department. */
  departmentOnly: boolean;
}

export function handoverPoolRule(role: string, hasDepartment: boolean): PoolRule {
  switch (role) {
    case "PANEL_MEMBER": return { roles: ["PANEL_MEMBER"], departmentOnly: true };
    case "HOD": return { roles: ["PANEL_MEMBER", "COLLEGE_STAFF"], departmentOnly: true };
    case "PRINCIPAL": return { roles: ["VICE_PRINCIPAL", "DEAN"], departmentOnly: false };
    case "VICE_PRINCIPAL": return { roles: ["HOD", "DEAN"], departmentOnly: false };
    case "COLLEGE_STAFF":
      return hasDepartment
        ? { roles: ["COLLEGE_STAFF"], departmentOnly: true }
        : { roles: ["COLLEGE_STAFF", "COLLEGE_OFFICE"], departmentOnly: false };
    default:
      return { roles: Array.from(new Set([role as UserRole, "COLLEGE_OFFICE", "COLLEGE_STAFF"])), departmentOnly: false };
  }
}

// users docs can still carry the un-normalized role (see the COLLEGE_ADMIN /
// DEPARTMENT_OFFICE notes in types/core.ts), so a query for the normalized
// role has to include its synonym too.
export function expandStoredRoles(roles: UserRole[]): UserRole[] {
  const out = new Set<UserRole>(roles);
  if (out.has("HOD")) out.add("DEPARTMENT_OFFICE");
  if (out.has("PRINCIPAL")) out.add("COLLEGE_ADMIN");
  return Array.from(out);
}

export interface PoolMember {
  uid: string;
  name: string;
  role: string;
  department: string;
}

export async function listPoolMembers(
  db: Firestore,
  collegeId: string,
  rule: PoolRule,
  opts: { department: string; excludeUid: string }
): Promise<PoolMember[]> {
  if (rule.departmentOnly && !opts.department) return [];
  const snap = await db.collection("colleges").doc(collegeId).collection("users")
    .where("role", "in", expandStoredRoles(rule.roles).slice(0, 30)).get();

  return snap.docs
    .filter((d) => d.id !== opts.excludeUid)
    .map((d) => {
      const u = d.data() as { name?: string; role?: string; department?: string; departments?: string[]; isActive?: boolean };
      return { uid: d.id, name: u.name ?? "Unknown", role: u.role ?? "", department: u.department ?? "", departments: u.departments ?? [], isActive: u.isActive };
    })
    .filter((u) => u.isActive !== false)
    .filter((u) => !rule.departmentOnly || u.department === opts.department || u.departments.includes(opts.department))
    .map(({ uid, name, role, department }) => ({ uid, name, role, department }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The handover picker's list: the asker's pool, minus anyone on leave (or
// awaiting a decision on their own leave) or already tied up with an
// adjustment of their own at any point in the requested range.
export async function listHandoverCandidates(
  db: Firestore,
  collegeId: string,
  who: { uid: string; role: string; department: string },
  range?: { fromISO: string; toISO: string }
): Promise<PoolMember[]> {
  const members = await listPoolMembers(db, collegeId, handoverPoolRule(who.role, !!who.department), {
    department: who.department, excludeUid: who.uid,
  });
  if (!range || members.length === 0) return members;
  const unavailability = await loadUnavailability(db, collegeId, range.fromISO, range.toISO);
  const busy = unavailability.unavailableUidsBetween(range.fromISO, range.toISO);
  return members.filter((m) => !busy.has(m.uid));
}
