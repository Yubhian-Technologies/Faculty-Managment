import type { Firestore } from "firebase-admin/firestore";

// Who is doing this, by name, for an audit entry. Best effort: the id alone is
// always recorded, a failed name lookup must never fail the request.
export async function actorOf(
  db: Firestore,
  collegeId: string,
  uid: string,
  fallback?: string
): Promise<{ uid: string; name: string }> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    const name = (snap.data() as { name?: string } | undefined)?.name;
    if (name) return { uid, name };
  } catch {
    /* fall through */
  }
  return { uid, name: fallback || "Unknown" };
}
