// Single Responsibility: read/write the per-college "not posted attendance"
// reminder settings - same doc-per-college-under-settings/ convention as
// lib/circular/settings.ts.

import type { Firestore, Timestamp } from "firebase-admin/firestore";

const SETTINGS_DOC = "attendanceNotPostedSettings";
const DEFAULT_CUTOFF_TIME = "18:00";

export interface AttendanceNotPostedSettings {
  collegeId: string;
  enabled: boolean;
  cutoffTime: string; // "HH:MM", 24h, IST
  // "YYYY-MM-DD" (IST) of the last day the sweep actually ran for this
  // college - the dedup guard so a scheduler firing every few minutes only
  // sweeps once per day per college, not once per tick past the cutoff.
  lastRunDate?: string;
  updatedAt?: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
}

function docRef(db: Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("settings").doc(SETTINGS_DOC);
}

export async function getNotPostedSettings(db: Firestore, collegeId: string): Promise<AttendanceNotPostedSettings> {
  const snap = await docRef(db, collegeId).get();
  if (!snap.exists) {
    return { collegeId, enabled: false, cutoffTime: DEFAULT_CUTOFF_TIME };
  }
  const data = snap.data() as AttendanceNotPostedSettings;
  return {
    collegeId,
    enabled: !!data.enabled,
    cutoffTime: /^\d{2}:\d{2}$/.test(data.cutoffTime) ? data.cutoffTime : DEFAULT_CUTOFF_TIME,
    lastRunDate: data.lastRunDate,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy,
    updatedByName: data.updatedByName,
  };
}

export async function saveNotPostedSettings(
  db: Firestore,
  collegeId: string,
  input: { enabled: boolean; cutoffTime: string },
  actor: { uid: string; name: string }
): Promise<AttendanceNotPostedSettings> {
  if (!/^\d{2}:\d{2}$/.test(input.cutoffTime)) throw new Error("cutoffTime must be HH:MM");
  const payload: Omit<AttendanceNotPostedSettings, "updatedAt"> & { updatedAt: Date } = {
    collegeId,
    enabled: input.enabled,
    cutoffTime: input.cutoffTime,
    updatedAt: new Date(),
    updatedBy: actor.uid,
    updatedByName: actor.name,
  };
  await docRef(db, collegeId).set(payload, { merge: true });
  return payload as unknown as AttendanceNotPostedSettings;
}

// Marks today (IST) as swept for this college - called once the sweep
// route has actually finished notifying, so a scheduler tick landing a few
// minutes later on the same day is a no-op.
export async function markSweptToday(db: Firestore, collegeId: string, dateISO: string): Promise<void> {
  await docRef(db, collegeId).set({ lastRunDate: dateISO }, { merge: true });
}
