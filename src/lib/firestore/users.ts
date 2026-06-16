import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { FMSUser, UserRole } from "@/types";

export async function getUserById(
  collegeId: string,
  uid: string
): Promise<FMSUser | null> {
  const ref = doc(db, "colleges", collegeId, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { uid: snap.id, ...snap.data() } as FMSUser;
}

export async function getUsersByRole(
  collegeId: string,
  role: UserRole
): Promise<FMSUser[]> {
  const ref = collection(db, "colleges", collegeId, "users");
  const q = query(
    ref,
    where("role", "==", role),
    where("isActive", "==", true),
    orderBy("name")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as FMSUser);
}

export async function getUsersByDepartment(
  collegeId: string,
  department: string
): Promise<FMSUser[]> {
  const ref = collection(db, "colleges", collegeId, "users");
  const q = query(
    ref,
    where("department", "==", department),
    where("isActive", "==", true)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as FMSUser);
}

export async function getAllUsers(collegeId: string): Promise<FMSUser[]> {
  const ref = collection(db, "colleges", collegeId, "users");
  const q = query(ref, orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as FMSUser);
}

export async function createUser(
  collegeId: string,
  uid: string,
  data: Omit<FMSUser, "uid" | "createdAt">
): Promise<void> {
  const ref = doc(db, "colleges", collegeId, "users", uid);
  await setDoc(ref, {
    ...data,
    collegeId,
    createdAt: Timestamp.now(),
  });
}

export async function updateUser(
  collegeId: string,
  uid: string,
  data: Partial<FMSUser>
): Promise<void> {
  const ref = doc(db, "colleges", collegeId, "users", uid);
  await updateDoc(ref, { ...data, updatedAt: Timestamp.now() });
}

export async function deactivateUser(
  collegeId: string,
  uid: string
): Promise<void> {
  await updateUser(collegeId, uid, { isActive: false });
}
