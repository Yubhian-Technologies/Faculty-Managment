// Shared user-creation logic for the L0-L6 provisioning chain: creates the
// Firebase Auth account plus the tenant-scoped profile doc + systemUsers
// pointer. Used by admin/users (manual single-user creation) and by the
// location/college creation wizards that provision a role atomically with
// their parent record. Keep in lockstep with ROLE_SCOPE in src/types/core.ts.

import { createFirebaseUser } from "@/lib/firebase/authRest";
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

// ADMINISTRATION / ACCOUNTS / HR_ADMIN / ADMIN_OFFICE / LOCATION_DEPT_HEAD — profile
// lives at locations/{id}/locationUsers/{uid}.
export async function provisionLocationUser(
  db: FirebaseFirestore.Firestore,
  locationId: string,
  role: UserRole,
  input: NewUserInput
): Promise<string> {
  const uid = await createFirebaseUser(input.email, input.password, input.name);
  const now = new Date();

  await db.collection("locations").doc(locationId).collection("locationUsers").doc(uid).set({
    uid, locationId, name: input.name, email: input.email, role,
    phone: input.phone ?? "",
    ...(input.academicProfile ? { academicProfile: input.academicProfile } : {}),
    ...(input.profilePhotoUrl ? { profilePhotoUrl: input.profilePhotoUrl } : {}),
    isActive: true, createdAt: now, updatedAt: now,
  });
  await db.collection("systemUsers").doc(uid).set({
    uid, role, locationId, collegeId: "", email: input.email, name: input.name,
    ...(input.profilePhotoUrl ? { profilePhotoUrl: input.profilePhotoUrl } : {}),
  });

  return uid;
}

// PRINCIPAL / VICE_PRINCIPAL / HOD etc — profile lives at colleges/{id}/users/{uid}.
export async function provisionCollegeUser(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  role: UserRole,
  input: NewUserInput,
  options?: { locationId?: string; performedBy?: string; performedByRole?: string }
): Promise<string> {
  const uid = await createFirebaseUser(input.email, input.password, input.name);
  const now = new Date();
  const locationId = options?.locationId ?? "";

  await db.collection("colleges").doc(collegeId).collection("users").doc(uid).set({
    uid, collegeId,
    ...(locationId ? { locationId } : {}),
    name: input.name, email: input.email, role,
    ...(input.collegeEmail ? { collegeEmail: input.collegeEmail } : {}),
    ...(input.employeeId ? { employeeId: input.employeeId } : {}),
    department: input.department ?? "",
    phone: input.phone ?? "",
    ...(input.academicProfile ? { academicProfile: input.academicProfile } : {}),
    ...(input.profilePhotoUrl ? { profilePhotoUrl: input.profilePhotoUrl } : {}),
    ...buildPersonalDetailsUpdate(input),
    isActive: true, createdAt: now, updatedAt: now,
  });
  await db.collection("systemUsers").doc(uid).set({
    uid, role, collegeId,
    ...(locationId ? { locationId } : {}),
    email: input.email, name: input.name,
    ...(input.profilePhotoUrl ? { profilePhotoUrl: input.profilePhotoUrl } : {}),
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
