/**
 * Read-only diagnostic: for every college, checks the Super Admin-configured
 * Nav Visibility settings (colleges/{id}/settings/navVisibility - see
 * /api/college/settings/nav-visibility) for whether any self-attendance nav
 * item ("My Attendance" for HOD/PRINCIPAL/VICE_PRINCIPAL, "Attendance" for
 * PANEL_MEMBER) is individually hidden, or its containing module ("Personal"
 * / "My Work") is hidden entirely, per role. Explains why the same role can
 * see "My Attendance" at one college but not another. Reads only - writes
 * nothing.
 *
 * Usage: node scripts/diagnose-attendance-nav-visibility.mjs
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

// role -> { href of the self-attendance nav item, module it falls under }
const ATTENDANCE_ITEMS = {
  PRINCIPAL: { href: "/principal/attendance", module: "Personal" },
  VICE_PRINCIPAL: { href: "/principal/attendance", module: "Personal" },
  HOD: { href: "/hod/attendance", module: "My Work" },
  PANEL_MEMBER: { href: "/panel/attendance", module: "General" },
};

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let flaggedCount = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const college = collegeDoc.data();
    const settingsSnap = await collegeDoc.ref.collection("settings").doc("navVisibility").get();
    if (!settingsSnap.exists) continue;
    const settings = settingsSnap.data() ?? {};

    for (const [role, { href, module }] of Object.entries(ATTENDANCE_ITEMS)) {
      const hiddenItems = settings.hiddenItems?.[role] ?? [];
      const hiddenModules = settings.hiddenModules?.[role] ?? [];
      const itemHidden = hiddenItems.includes(href);
      const moduleHidden = module !== "General" && hiddenModules.includes(module);
      if (itemHidden || moduleHidden) {
        flaggedCount++;
        console.log(
          `[${college.name ?? collegeDoc.id}] ${role}: ${href} hidden via ${itemHidden ? "hiddenItems" : ""}${itemHidden && moduleHidden ? " + " : ""}${moduleHidden ? `hiddenModules("${module}")` : ""}`
        );
      }
    }
  }

  console.log(`\n${flaggedCount} college/role combination(s) have self-attendance hidden.`);
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
