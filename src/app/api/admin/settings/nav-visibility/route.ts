export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { NavVisibilitySettings, UserRole } from "@/types";

const DEFAULT_SETTINGS: NavVisibilitySettings = {
  hiddenModules: {},
  hiddenItems: {},
};

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();

    const collegeId = new URL(request.url).searchParams.get("collegeId");
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(collegeId)
      .collection("settings").doc("navVisibility")
      .get();

    const settings: NavVisibilitySettings = snap.exists
      ? { ...DEFAULT_SETTINGS, ...(snap.data() as NavVisibilitySettings) }
      : DEFAULT_SETTINGS;

    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/settings/nav-visibility GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSuperAdmin();

    const body = (await request.json()) as {
      collegeId?: string;
      role?: UserRole;
      hiddenModules?: string[];
      hiddenItems?: string[];
    };
    const { collegeId, role, hiddenModules, hiddenItems } = body;
    if (!collegeId || !role || !Array.isArray(hiddenModules) || !Array.isArray(hiddenItems)) {
      return NextResponse.json(
        { error: "collegeId, role, hiddenModules[], and hiddenItems[] are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const now = new Date();
    const updatedByName = session.email || "Super Admin";

    const docRef = db.collection("colleges").doc(collegeId).collection("settings").doc("navVisibility");
    await docRef.set(
      {
        hiddenModules: { [role]: hiddenModules },
        hiddenItems: { [role]: hiddenItems },
        updatedAt: now,
        updatedByName,
      },
      { merge: true }
    );

    await db.collection("auditLogs").add({
      action: "NAV_VISIBILITY_UPDATED",
      performedBy: session.uid,
      performedByName: updatedByName,
      details: { collegeId, role, hiddenModules, hiddenItems },
      timestamp: now,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/settings/nav-visibility PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
