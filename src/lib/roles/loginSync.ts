import { FieldValue } from "firebase-admin/firestore";

// Cascades a name/photo change into a linked login (colleges/{id}/users +
// systemUsers, both keyed by uid) - the login doc is what panel-member
// pickers, notifications, and the nav/avatar read from, so an edit made on
// the faculty/supporting-staff details page must propagate or those surfaces
// show stale data from account creation time.
//
// This used to be a bare `try { ... } catch { /* non-fatal */ }` in both
// callers - a failed sync was completely invisible: no log, no flag, no way
// to know the login had drifted out of sync. Now a failure is logged AND
// stamped on the SOURCE record (loginSyncStatus/loginSyncError), the same
// "status + error field, fixed by re-triggering the write" idiom this
// codebase already uses for department rename cascades (cascadeStatus/
// cascadeError - see cascadeDepartmentRename). Stamping the failure is itself
// best-effort (its own try/catch) so a failure to record the failure can't
// throw and break the caller's own successful primary update.
export async function syncLinkedLoginName(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  sourceRef: FirebaseFirestore.DocumentReference,
  linkedUid: string,
  loginSync: Record<string, string>
): Promise<void> {
  try {
    await db.collection("colleges").doc(collegeId).collection("users").doc(linkedUid)
      .set(loginSync, { merge: true });
    await db.collection("systemUsers").doc(linkedUid).set(loginSync, { merge: true });
    // Clears a previous failure once a later save actually succeeds - same
    // "retry by re-triggering the write" idiom as resyncNameCascade.
    await sourceRef.update({
      loginSyncStatus: FieldValue.delete(),
      loginSyncError: FieldValue.delete(),
    }).catch(() => { /* best-effort clear only - not worth failing the request over */ });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[loginSync] failed to sync login for uid ${linkedUid} (college ${collegeId}):`, err);
    await sourceRef.update({
      loginSyncStatus: "FAILED",
      loginSyncError: message,
      loginSyncUpdatedAt: new Date(),
    }).catch((flagErr) => {
      console.error(`[loginSync] also failed to record the failure on ${sourceRef.path}:`, flagErr);
    });
  }
}
