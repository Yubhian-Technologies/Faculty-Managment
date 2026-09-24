export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveNavVisibility } from "@/lib/navVisibilityDefaults";
import type { NavVisibilitySettings } from "@/types";

// Any logged-in college-scoped user reads the college's hidden modules/items,
// keyed by role, and the client applies the ones for every role the login holds
// (primary role + seats such as Principal/HOD) - used by Sidebar/MobileDrawer/
// BottomNav to filter nav client-side. Not sensitive: it only says which nav
// entries are switched off.
//
// Defaults (see navVisibilityDefaults.ts) are applied here so what the Super
// Admin sees ticked in Settings is exactly what is enforced, even for a college
// that has never saved anything.
export async function GET() {
  const empty = { hiddenModules: {}, hiddenItems: {} };
  try {
    const session = await verifySession();
    if (!session || !session.collegeId) {
      return NextResponse.json(empty, { headers: { "Cache-Control": "no-store" } });
    }

    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("settings").doc("navVisibility")
      .get();

    const { hiddenModules, hiddenItems } = resolveNavVisibility(
      snap.exists ? (snap.data() as NavVisibilitySettings) : undefined
    );
    return NextResponse.json({ hiddenModules, hiddenItems }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[college/settings/nav-visibility GET]", err);
    return NextResponse.json(empty);
  }
}
