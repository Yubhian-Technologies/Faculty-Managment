/**
 * Fix for the gap found by diagnose-attendance-nav-visibility.mjs: removes
 * only the self-attendance href ("/principal/attendance", "/hod/attendance",
 * "/panel/attendance") from each affected college's per-role hiddenItems in
 * colleges/{id}/settings/navVisibility - restoring "My Attendance" visibility
 * without touching any other hidden-item/module entry those colleges may
 * have deliberately configured for unrelated features.
 *
 * Usage: node scripts/fix-attendance-nav-visibility.mjs
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = getFirestore();

const ATTENDANCE_HREFS = {
  PRINCIPAL: "/principal/attendance",
  VICE_PRINCIPAL: "/principal/attendance",
  HOD: "/hod/attendance",
  PANEL_MEMBER: "/panel/attendance",
};

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let fixedCount = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const college = collegeDoc.data();
    const settingsRef = collegeDoc.ref.collection("settings").doc("navVisibility");
    const settingsSnap = await settingsRef.get();
    if (!settingsSnap.exists) continue;
    const settings = settingsSnap.data() ?? {};
    const hiddenItems = settings.hiddenItems ?? {};

    let changed = false;
    const updatedHiddenItems = {};
    for (const [role, items] of Object.entries(hiddenItems)) {
      const href = ATTENDANCE_HREFS[role];
      if (!Array.isArray(items) || !href || !items.includes(href)) {
        updatedHiddenItems[role] = items;
        continue;
      }
      updatedHiddenItems[role] = items.filter((i) => i !== href);
      changed = true;
      fixedCount++;
      console.log(`[${college.name ?? collegeDoc.id}] ${role}: un-hiding ${href}`);
    }

    if (changed) {
      await settingsRef.update({ hiddenItems: updatedHiddenItems });
    }
  }

  console.log(`\nFixed ${fixedCount} college/role combination(s).`);
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
