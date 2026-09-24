// Single Responsibility: read/write circular message-from options.
// Depends only on Firestore abstraction, not on UI or auth.

import type { Firestore } from "firebase-admin/firestore";
import { DEFAULT_MESSAGE_FROM_OPTIONS, type CircularSettings } from "@/types/circular";

const SETTINGS_DOC = "circularSettings";

function docRef(db: Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("settings").doc(SETTINGS_DOC);
}

export async function getCircularSettings(db: Firestore, collegeId: string): Promise<CircularSettings> {
  const snap = await docRef(db, collegeId).get();
  if (!snap.exists) {
    return {
      collegeId,
      messageFromOptions: [...DEFAULT_MESSAGE_FROM_OPTIONS],
      updatedAt: new Date() as unknown as CircularSettings["updatedAt"],
    };
  }
  const data = snap.data() as CircularSettings;
  if (!data.messageFromOptions?.length) data.messageFromOptions = [...DEFAULT_MESSAGE_FROM_OPTIONS];
  return data;
}

export async function saveCircularSettings(
  db: Firestore,
  collegeId: string,
  options: string[],
  actor: { uid: string; name: string }
): Promise<CircularSettings> {
  const now = new Date() as unknown as CircularSettings["updatedAt"];
  const cleaned = [...new Set(options.map((s) => s.trim()).filter(Boolean))];
  if (cleaned.length === 0) throw new Error("At least one message-from option is required");
  const payload: CircularSettings = {
    collegeId,
    messageFromOptions: cleaned,
    updatedAt: now,
    updatedBy: actor.uid,
    updatedByName: actor.name,
  };
  await docRef(db, collegeId).set(payload, { merge: true });
  return payload;
}
