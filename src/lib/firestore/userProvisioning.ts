// Shared user-creation logic for the L0-L6 provisioning chain: creates the
// Firebase Auth account plus the tenant-scoped profile doc + systemUsers
// pointer. Used by admin/users (manual single-user creation of GLOBAL/LOCATION
// roles, plus DIRECTOR). Every other COLLEGE-scoped role (Principal and below)
// is a seat now, appointed from within the college via Role Assignments, not
// provisioned here - see api/administration/college-people for the one
// exception (the College Admin bootstrap). Keep in lockstep with ROLE_SCOPE in
// src/types/core.ts.

import { withAuthUser } from "@/lib/firebase/withAuthUser";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import type { UserRole } from "@/types";

export interface NewUserInput extends PersonalDetailsInput {
  name: string;
  email: string;
  collegeEmail?: string;
  employeeId?: string;
  password: string;
  phone?: string;
  department?: string;
  academicProfile?: Record<string, unknown>;
  profilePhotoUrl?: string;
}

// ADMINISTRATION / ACCOUNTS / HR_ADMIN / ADMIN_OFFICE / LOCATION_DEPT_HEAD - profile
// lives at locations/{id}/locationUsers/{uid}.
export async function provisionLocationUser(
  db: FirebaseFirestore.Firestore,
  locationId: string,
  role: UserRole,
  input: NewUserInput
): Promise<string> {
  const now = new Date();

  // Login + profile + role mapping are one unit (withAuthUser): one batch, and a
  // failure removes the Auth user again instead of orphaning it.
  return withAuthUser({ email: input.email, password: input.password, displayName: input.name, db }, async (uid) => {
    const batch = db.batch();
    batch.set(db.collection("locations").doc(locationId).collection("locationUsers").doc(uid), {
      uid, locationId, name: input.name, email: input.email, role,
      phone: input.phone ?? "",
      ...(input.academicProfile ? { academicProfile: normalizeAcademicProfile(input.academicProfile) } : {}),
      ...(input.profilePhotoUrl ? { profilePhotoUrl: input.profilePhotoUrl } : {}),
      isActive: true, createdAt: now, updatedAt: now,
    });
    batch.set(db.collection("systemUsers").doc(uid), {
      uid, role, locationId, collegeId: "", email: input.email, name: input.name,
      ...(input.profilePhotoUrl ? { profilePhotoUrl: input.profilePhotoUrl } : {}),
    });
    await batch.commit();
    return uid;
  });
}

// DIRECTOR (Super Admin-provisioned) - profile lives at colleges/{id}/users/{uid}.
export async function provisionCollegeUser(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  role: UserRole,
  input: NewUserInput,
  options?: { locationId?: string; performedBy?: string; performedByRole?: string }
): Promise<string> {
  const now = new Date();
  const locationId = options?.locationId ?? "";

  // Same unit-of-work rule as provisionLocationUser: profile + role mapping in one
  // batch, Auth user removed again on failure.
  const uid = await withAuthUser({ email: input.email, password: input.password, displayName: input.name, db }, async (newUid) => {
    const batch = db.batch();
    batch.set(db.collection("colleges").doc(collegeId).collection("users").doc(newUid), {
      uid: newUid, collegeId,
      ...(locationId ? { locationId } : {}),
      name: input.name, email: input.email, role,
      ...(input.collegeEmail ? { collegeEmail: input.collegeEmail } : {}),
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
      department: input.department ?? "",
      phone: input.phone ?? "",
      ...(input.academicProfile ? { academicProfile: normalizeAcademicProfile(input.academicProfile) } : {}),
      ...(input.profilePhotoUrl ? { profilePhotoUrl: input.profilePhotoUrl } : {}),
      ...buildPersonalDetailsUpdate(input),
      isActive: true, createdAt: now, updatedAt: now,
    });
    batch.set(db.collection("systemUsers").doc(newUid), {
      uid: newUid, role, collegeId,
      ...(locationId ? { locationId } : {}),
      email: input.email, name: input.name,
      ...(input.profilePhotoUrl ? { profilePhotoUrl: input.profilePhotoUrl } : {}),
    });
    await batch.commit();
    return newUid;
  });

  if (options?.performedBy) {
    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId, action: "USER_CREATED",
      performedBy: options.performedBy, performedByName: options.performedByRole ?? role,
      targetId: uid, details: { email: input.email, role, name: input.name }, timestamp: now,
    });
  }

  return uid;
}
