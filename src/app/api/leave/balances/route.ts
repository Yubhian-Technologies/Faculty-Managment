export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { PROFILES_COL, loadBalances, computeEntitlement } from "@/lib/leave/balanceEngine";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import type { EmployeeLeaveProfile } from "@/types/leave";

// Balances for CL/SL/SCL/EL (whichever the profile's effective category is
// eligible for) plus an `unlimited: true` entry for OD - no balance is ever
// tracked for OD, the UI shows its request history instead.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF"
    );
    const url = new URL(request.url);
    const targetUid = url.searchParams.get("uid") || session.uid;
    const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

    const db = getAdminDb();
    if (!(await canAccessLeaveProfile(db, session.collegeId, session.role, session.uid, targetUid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const profileSnap = await PROFILES_COL(session.collegeId, db).doc(targetUid).get();
    if (!profileSnap.exists) {
      return NextResponse.json({ error: "Leave profile not set up yet" }, { status: 404 });
    }
    const profile = { id: profileSnap.id, ...profileSnap.data() } as EmployeeLeaveProfile;

    const settings = await loadCollegeSettings(db, session.collegeId);
    const effectiveCategory = computeEffectiveCategory(profile, settings.newJoiningYears);

    const balances = await loadBalances(db, session.collegeId, targetUid, year);
    const balancesByType = new Map(balances.map((b) => [b.leaveTypeCode, b]));

    const eligibleTypes = LEAVE_TYPE_SEED
      .filter((lt) => lt.isActive && lt.rules.eligibleCategories.includes(effectiveCategory))
      .map((lt) => {
        if (lt.rules.unlimited) {
          return { code: lt.code, label: lt.label, shortLabel: lt.shortLabel, color: lt.color, unlimited: true as const };
        }
        const bal = balancesByType.get(lt.code);
        const entitled = bal?.entitled ?? computeEntitlement(lt, effectiveCategory);
        const used = bal?.used ?? 0;
        const pending = bal?.pending ?? 0;
        return {
          code: lt.code,
          label: lt.label,
          shortLabel: lt.shortLabel,
          color: lt.color,
          unlimited: false as const,
          entitled,
          used,
          pending,
          remaining: Math.max(0, entitled - used - pending),
        };
      });

    return NextResponse.json({ effectiveCategory, leaveTypes: eligibleTypes });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/balances GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
