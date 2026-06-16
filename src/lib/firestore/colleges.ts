import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { College } from "@/types";

export async function getAllColleges(): Promise<College[]> {
  const ref = collection(db, "colleges");
  const q = query(ref, orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as College);
}

export async function getCollege(collegeId: string): Promise<College | null> {
  const ref = doc(db, "colleges", collegeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as College;
}

export async function updateCollege(
  collegeId: string,
  data: Partial<Omit<College, "id" | "createdAt">>
): Promise<void> {
  const ref = doc(db, "colleges", collegeId);
  await updateDoc(ref, { ...data, updatedAt: Timestamp.now() });
}
