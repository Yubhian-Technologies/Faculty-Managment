import type { DocumentReference, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { rollNumberUpperOf, studentRollKey } from "@/lib/students/loginDefaults";
import { REGISTRY_COLLECTION, registryRef } from "@/lib/students/rollIdentity";

// Deleting a student is PERMANENT and complete: nothing is archived or kept.
// Everything that exists only because of this student goes with them -
//   - the student document and its departmentHistory entries,
//   - their login: the Firebase Auth user, colleges/{id}/users/{uid} and systemUsers/{uid}
//     (only when those are student profiles, never a staff member's),
//   - their roll number's registry entry (studentUsernames), so the number is free again.
// Records that merely REFER to the student by id (attendance sessions, marks, library
// history, uploaded documents) belong to other modules and are left as they are.
//
// Order, so a failure part-way is safe to simply run again: the Auth user goes first
// (a missing one is fine), and the Firestore documents are removed only for students
// whose login was removed - a student whose login could not be deleted stays fully
// intact and is reported, instead of leaving a login with no student behind it.

interface StudentData {
  uid?: string;
  rollNumber?: string;
}

interface RegistryData {
  collegeId?: string;
  studentDocId?: string;
  uid?: string;
}

const CONCURRENCY = 5;

function isAuthNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "auth/user-not-found";
}

/** The registry entry belongs to this student (by id, or - for a legacy entry - by login). */
function registryEntryIsTheirs(entry: RegistryData, collegeId: string, studentDocId: string, uid?: string): boolean {
  if (entry.collegeId === collegeId && entry.studentDocId === studentDocId) return true;
  return !entry.studentDocId && !!uid && entry.uid === uid;
}

async function refsToDelete(db: Firestore, collegeId: string, snap: DocumentSnapshot): Promise<DocumentReference[]> {
  const student = (snap.data() ?? {}) as StudentData;
  const refs: DocumentReference[] = [snap.ref];

  const history = await snap.ref.collection("departmentHistory").get();
  for (const h of history.docs) refs.push(h.ref);

  if (student.uid) {
    // Only a STUDENT profile is removed - the uid must never take a staff login with it.
    const profile = db.collection("colleges").doc(collegeId).collection("users").doc(student.uid);
    const system = db.collection("systemUsers").doc(student.uid);
    const [profileSnap, systemSnap] = await Promise.all([profile.get(), system.get()]);
    if (profileSnap.exists && (profileSnap.data() as { role?: string }).role === "STUDENT") refs.push(profile);
    if (systemSnap.exists && (systemSnap.data() as { role?: string }).role === "STUDENT") refs.push(system);
  }

  // The roll's registry entry: the normalised one, the legacy roll-keyed one, and any
  // entry carrying this student's login.
  const seen = new Set<string>();
  const addRegistry = (ref: DocumentReference) => {
    if (!seen.has(ref.path)) {
      seen.add(ref.path);
      refs.push(ref);
    }
  };
  const roll = typeof student.rollNumber === "string" ? student.rollNumber : "";
  const candidates: DocumentReference[] = [];
  if (studentRollKey(roll)) candidates.push(registryRef(db, roll));
  const legacyId = rollNumberUpperOf(roll);
  if (legacyId && !legacyId.includes("/")) candidates.push(db.collection(REGISTRY_COLLECTION).doc(legacyId));
  for (const ref of candidates) {
    const entry = await ref.get();
    if (entry.exists && registryEntryIsTheirs(entry.data() as RegistryData, collegeId, snap.id, student.uid)) addRegistry(ref);
  }
  if (student.uid) {
    const byUid = await db.collection(REGISTRY_COLLECTION).where("uid", "==", student.uid).get();
    for (const d of byUid.docs) addRegistry(d.ref);
  }
  return refs;
}

export interface DeleteStudentsResult {
  /** Ids of the students that were deleted. */
  deletedIds: string[];
  /** Ids whose login could not be removed - they were left fully intact; delete them again. */
  failedIds: string[];
}

/**
 * Permanently deletes the given (existing) students and everything listed above.
 * `getAuth` is only called when at least one of them has a login.
 */
export async function deleteStudentsCompletely(
  db: Firestore,
  getAuth: () => Promise<Auth>,
  collegeId: string,
  snaps: DocumentSnapshot[]
): Promise<DeleteStudentsResult> {
  const deletedIds: string[] = [];
  const failedIds: string[] = [];
  const batch = new ChunkedBatch(db);
  let adminAuth: Auth | null = null;

  for (let i = 0; i < snaps.length; i += CONCURRENCY) {
    const group = snaps.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      group.map(async (snap) => {
        const uid = (snap.data() as StudentData | undefined)?.uid;
        const refs = await refsToDelete(db, collegeId, snap);
        if (uid) {
          try {
            adminAuth = adminAuth ?? (await getAuth());
            await adminAuth.deleteUser(uid);
          } catch (err) {
            if (!isAuthNotFound(err)) {
              console.error("[deleteStudentsCompletely] could not delete the login", snap.id, err);
              return { id: snap.id, refs: null };
            }
          }
        }
        return { id: snap.id, refs };
      })
    );
    for (const r of results) {
      if (!r.refs) {
        failedIds.push(r.id);
        continue;
      }
      for (const ref of r.refs) batch.delete(ref);
      deletedIds.push(r.id);
    }
  }

  if (deletedIds.length > 0) await batch.commit();
  return { deletedIds, failedIds };
}
