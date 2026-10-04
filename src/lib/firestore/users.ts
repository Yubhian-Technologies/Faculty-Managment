import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { FMSUser } from "@/types";
import { migrateUserDoc } from "@/lib/faculty/fieldRenames";

export async function getUserById(
  collegeId: string,
  uid: string
): Promise<FMSUser | null> {
  const ref = doc(db, "colleges", collegeId, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  // Lift legacy personal/academicProfile key names (un-migrated docs) to the current ones.
  return { uid: snap.id, ...migrateUserDoc(snap.data()) } as FMSUser;
}
