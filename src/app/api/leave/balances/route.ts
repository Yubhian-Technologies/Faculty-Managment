export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { EmployeeLeaveProfile } from "@/types/leave";
import {
  loadBalances,
  initBalancesForYear,
  PROFILES_COL,
} from "@/lib/leave/balanceEngine";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "SUPER_ADMIN"
    );

    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()), 10);

    const db = getAdminDb();

    // Look up target uid (self by default, or a specific uid for HOD/Principal viewing their team)
    const targetUid = searchParams.get("uid") ?? session.uid;
    const targetCollegeId = session.collegeId;

    // Fetch employee profile — needed for balance initialization
    const profileSnap = await PROFILES_COL(targetCollegeId, db).doc(targetUid).get();
    const profile = profileSnap.exists
      ? ({ id: profileSnap.id, ...profileSnap.data() } as EmployeeLeaveProfile)
      : null;

    // Lazy-initialize balances if profile exists and this is the first load of the year
    if (profile) {
      await initBalancesForYear(db, targetCollegeId, targetUid, profile, year);
    }

    const balances = await loadBalances(db, targetCollegeId, targetUid, year);

    return NextResponse.json({ balances, profile, year });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/balances GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
