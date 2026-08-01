export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { NavVisibilitySettings } from "@/types";

// Any logged-in college-scoped user reads their own role's hidden modules/items
// for their own college — used by Sidebar/MobileDrawer/BottomNav to filter nav
// client-side. Not sensitive: it only reveals which of the user's own nav items
// are hidden, nothing about other roles or colleges.
export async function GET() {
  try {
    const session = await verifySession();
    if (!session || !session.collegeId) {
      return NextResponse.json({ hiddenModules: [], hiddenItems: [] });
    }

    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("settings").doc("navVisibility")
      .get();

    if (!snap.exists) {
      return NextResponse.json({ hiddenModules: [], hiddenItems: [] });
    }

    const settings = snap.data() as NavVisibilitySettings;
    return NextResponse.json({
      hiddenModules: settings.hiddenModules?.[session.role as keyof typeof settings.hiddenModules] ?? [],
      hiddenItems: settings.hiddenItems?.[session.role as keyof typeof settings.hiddenItems] ?? [],
    });
  } catch (err) {
    console.error("[college/settings/nav-visibility GET]", err);
    return NextResponse.json({ hiddenModules: [], hiddenItems: [] });
  }
}
