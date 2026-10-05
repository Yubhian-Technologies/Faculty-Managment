import type { Firestore } from "firebase-admin/firestore";

export const MAX_EMPLOYEE_ID_LENGTH = 64;

/**
 * The login uid of the faculty member holding this employee ID, or null.
 * Employee IDs are unique across all colleges (see lib/firestore/employeeIds.ts),
 * so a collection-group lookup is unambiguous. Tries the ID as typed, upper and
 * lower case, since IDs are stored as entered.
 */
export async function findFacultyLoginUid(db: Firestore, employeeId: string): Promise<string | null> {
  const id = employeeId.trim();
  if (!id) return null;
  const variants = Array.from(new Set([id, id.toUpperCase(), id.toLowerCase()]));
  const snap = await db.collectionGroup("facultyMembers").where("employeeId", "in", variants).limit(5).get();
  for (const d of snap.docs) {
    const uid = d.get("userUid");
    if (typeof uid === "string" && uid) return uid;
  }
  return null;
}
