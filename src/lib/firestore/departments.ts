import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  orderBy,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { Department } from "@/types";

export async function getDepartments(collegeId: string): Promise<Department[]> {
  const ref = collection(db, "colleges", collegeId, "departments");
  const q = query(ref, where("isActive", "==", true), orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department);
}

export async function getAllDepartments(collegeId: string): Promise<Department[]> {
  const ref = collection(db, "colleges", collegeId, "departments");
  const q = query(ref, orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department);
}

export async function updateDepartment(
  collegeId: string,
  deptId: string,
  data: Partial<Omit<Department, "id" | "collegeId" | "createdAt">>
): Promise<void> {
  const ref = doc(db, "colleges", collegeId, "departments", deptId);
  await updateDoc(ref, { ...data, updatedAt: Timestamp.now() });
}

export async function deleteDepartment(
  collegeId: string,
  deptId: string
): Promise<void> {
  const ref = doc(db, "colleges", collegeId, "departments", deptId);
  await deleteDoc(ref);
}
