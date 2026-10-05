// Gate for the `dateKey` fast path on attendanceRecords.
//
// New records carry dateKey (the IST YYYY-MM-DD, also the suffix of the doc id
// `${uid}_${dateKey}`). Older records don't, so reading by dateKey is only
// complete after scripts/backfill-attendance-date-keys.mjs --apply has run for
// the college; the script then writes this marker doc. Until the marker exists
// every reader keeps the original behaviour, so deploying the code changes nothing.

import type { DocumentReference } from "firebase-admin/firestore";

const TTL_MS = 60_000;
const cache = new Map<string, { ready: boolean; at: number }>();

export function dateKeysMarkerRef(collegeRef: DocumentReference): DocumentReference {
  return collegeRef.collection("counters").doc("attendanceDateKeys");
}

export async function attendanceDateKeysReady(collegeRef: DocumentReference): Promise<boolean> {
  const hit = cache.get(collegeRef.path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ready;
  let ready = false;
  try {
    ready = (await dateKeysMarkerRef(collegeRef).get()).get("backfilled") === true;
  } catch {
    ready = false;
  }
  cache.set(collegeRef.path, { ready, at: Date.now() });
  return ready;
}

export function clearAttendanceDateKeyCache(): void {
  cache.clear();
}
