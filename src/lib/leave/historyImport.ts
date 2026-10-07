import type { Firestore } from "firebase-admin/firestore";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { REQUESTS_COL, commitApproval, splitLeaveDays } from "@/lib/leave/balanceEngine";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import type { EmployeeLeaveProfile, LeaveActionRecord, LeaveRequest, LeaveTypeCode } from "@/types/leave";
import type { UserRole } from "@/types";

// What the monthly and the year-wise Leave History imports share: finding the staff login a row
// names, and recording each leave figure as already-APPROVED leave.

// Excludes STUDENT/CLASS_LEADER when matching a row's identifier to a login -
// they never have a leave profile (see lib/leave/identity.ts).
const NON_STAFF_ROLES: UserRole[] = ["STUDENT", "CLASS_LEADER"];

export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
}

export interface StaffLookup {
  byEmployeeId: Map<string, string>;
  byNormalizedName: Map<string, string>;
  namesByUid: Map<string, string>;
}

export async function loadStaffLookup(db: Firestore, collegeId: string): Promise<StaffLookup> {
  const [usersSnap, facultySnap, supportingStaffSnap] = await Promise.all([
    db.collection("colleges").doc(collegeId).collection("users").get(),
    db.collection("colleges").doc(collegeId).collection("facultyMembers").get(),
    db.collection("colleges").doc(collegeId).collection("supportingStaff").get(),
  ]);
  const byEmployeeId = new Map<string, string>();
  const byNormalizedName = new Map<string, string>();
  const namesByUid = new Map<string, string>();
  for (const doc of usersSnap.docs) {
    const data = doc.data() as { name?: string; employeeId?: string; role?: UserRole };
    if (!data.role || NON_STAFF_ROLES.includes(data.role)) continue;
    if (data.employeeId?.trim()) byEmployeeId.set(data.employeeId.trim().toLowerCase(), doc.id);
    if (data.name) {
      namesByUid.set(doc.id, data.name);
      const key = normalizeName(data.name);
      if (!byNormalizedName.has(key)) byNormalizedName.set(key, doc.id); // first match wins on duplicate names
    }
  }
  // The Add/Import Faculty and Add/Import Supporting Staff flows both set
  // employeeId on the facultyMembers/supportingStaff doc itself, never on
  // the linked `users` doc (see faculty/import POST's own payload) - so the
  // loop above, which only reads users.employeeId, never actually resolves
  // an Employee Code for staff onboarded the normal way (confirmed live:
  // a populated college can have 0 of its users docs carrying employeeId
  // while its facultyMembers docs all do). Filled in here from both
  // collections' own employeeId + userUid, keyed the same way so a row's
  // Employee Code matches regardless of which flow actually created the
  // login.
  for (const doc of facultySnap.docs) {
    const data = doc.data() as { employeeId?: string; userUid?: string };
    if (data.employeeId?.trim() && data.userUid) byEmployeeId.set(data.employeeId.trim().toLowerCase(), data.userUid);
  }
  for (const doc of supportingStaffSnap.docs) {
    const data = doc.data() as { employeeId?: string; userUid?: string };
    if (data.employeeId?.trim() && data.userUid) byEmployeeId.set(data.employeeId.trim().toLowerCase(), data.userUid);
  }
  return { byEmployeeId, byNormalizedName, namesByUid };
}

/** The staff login a row's Employee Code / Name points at, or undefined. */
export function resolveStaffUid(lookup: StaffLookup, rawEmployeeId: string, rawName: string): string | undefined {
  return (rawEmployeeId && lookup.byEmployeeId.get(rawEmployeeId.toLowerCase()))
    || (rawName && lookup.byNormalizedName.get(normalizeName(rawName)))
    || undefined;
}

export interface ImportTask {
  row: number;
  identifier: string;
  uid: string;
  code: LeaveTypeCode;
  year: number;
  month: number; // 1-12
  days: number;
}

/** Oldest first per employee, so a balance used up by an earlier month is already counted for a later one. */
export function sortImportTasks(tasks: ImportTask[]): void {
  tasks.sort((a, b) => a.uid.localeCompare(b.uid) || a.year - b.year || a.month - b.month);
}

/**
 * Records each task as one synthetic single-day APPROVED request dated the 1st of its month,
 * committing balance and Loss of Pay exactly like a real approval (splitLeaveDays/commitApproval).
 * Returns how many were created; a task that cannot be recorded is added to `failed`.
 */
export async function commitImportTasks(
  db: Firestore,
  collegeId: string,
  actor: { uid: string; name: string },
  namesByUid: Map<string, string>,
  tasks: ImportTask[],
  failed: { row: number; identifier: string; error: string }[],
): Promise<number> {
  const now = new Date();
  const profileCache = new Map<string, EmployeeLeaveProfile | null>();
  let created = 0;

  for (const task of tasks) {
    let profile = profileCache.get(task.uid);
    if (profile === undefined) {
      profile = await getOrCreateProfile(db, collegeId, task.uid);
      profileCache.set(task.uid, profile);
    }
    if (!profile) {
      failed.push({ row: task.row, identifier: task.identifier, error: "Employee record not found" });
      continue;
    }

    let lopDays = 0;
    const lt = LEAVE_TYPE_SEED.find((t) => t.code === task.code);
    if (lt && !lt.rules.unlimited) {
      const split = await splitLeaveDays(db, collegeId, task.uid, lt, task.year, task.days);
      lopDays = split.lopDays;
      if (split.withinBalance > 0) {
        await commitApproval(db, collegeId, task.uid, task.code, task.year, split.withinBalance);
      }
    }

    const actionRecord: LeaveActionRecord = {
      action: "APPROVED",
      by: actor.uid,
      byName: actor.name,
      at: now as unknown as LeaveActionRecord["at"],
      remarks: "Imported historical record",
    };

    const fromDate = new Date(task.year, task.month - 1, 1);
    const newRequest: Omit<LeaveRequest, "id"> = {
      collegeId,
      uid: task.uid,
      employeeName: namesByUid.get(task.uid) ?? task.identifier,
      ...(profile.department ? { department: profile.department } : {}),
      leaveTypeCode: task.code,
      isOtherRequest: false,
      fromDate: fromDate as unknown as LeaveRequest["fromDate"],
      toDate: fromDate as unknown as LeaveRequest["toDate"],
      totalDays: task.days,
      reason: "Imported record",
      status: "APPROVED",
      lopDays,
      hodAction: actionRecord,
      createdAt: now as unknown as LeaveRequest["createdAt"],
      updatedAt: now as unknown as LeaveRequest["updatedAt"],
    };

    await REQUESTS_COL(collegeId, db).add(newRequest);
    created++;
  }
  return created;
}

/** "uid|code|year|month" of every request this importer already recorded for these employees. */
export async function loadImportedKeys(db: Firestore, collegeId: string, uids: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const uid of new Set(uids)) {
    const snap = await REQUESTS_COL(collegeId, db).where("uid", "==", uid).get();
    for (const d of snap.docs) {
      const r = d.data() as { reason?: string; status?: string; leaveTypeCode?: string; fromDate?: unknown };
      if (r.reason !== "Imported record" || r.status !== "APPROVED") continue;
      const from = (r.fromDate as { toDate?: () => Date } | undefined)?.toDate?.();
      if (from) keys.add(`${uid}|${r.leaveTypeCode}|${from.getFullYear()}|${from.getMonth() + 1}`);
    }
  }
  return keys;
}
