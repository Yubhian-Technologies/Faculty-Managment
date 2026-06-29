export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  LEAVE_COL,
  PROFILES_COL,
  balanceDocId,
  computeEntitlement,
} from "@/lib/leave/balanceEngine";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import type { LeaveBalanceV2, LeaveTypeFull, LeaveTypeCodeV2 } from "@/types/leave";

const EL_CODE: LeaveTypeCodeV2 = "EL";
const EL_CARRY_CAP = 300;

// POST /api/leave/carry-forward
// Body: { targetYear?: number }  — defaults to current calendar year
// Action: for every employee in the college with an EL balance for targetYear,
//   computes carry-forward = min(300, opening + credited - used)
//   and writes a next-year EL balance doc with opening = carryForward.
// Only SUPER_ADMIN may call this.

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("SUPER_ADMIN");

    const body = (await request.json().catch(() => ({}))) as { targetYear?: number; collegeId?: string };
    const fromYear = body.targetYear ?? new Date().getFullYear();
    const toYear = fromYear + 1;

    // Allow SUPER_ADMIN to target a specific college or default to session college
    const collegeId = body.collegeId ?? session.collegeId;

    const db = getAdminDb();

    // Load EL leave type config
    const ltSnap = await db.collection("leaveTypes").doc(EL_CODE).get();
    const elType: LeaveTypeFull = ltSnap.exists
      ? ({ id: ltSnap.id, ...ltSnap.data() } as LeaveTypeFull)
      : (LEAVE_TYPE_SEED.find((l) => l.code === EL_CODE) as LeaveTypeFull);

    // Fetch all EL balances for the source year
    const balancesSnap = await LEAVE_COL(collegeId, db)
      .where("leaveTypeCode", "==", EL_CODE)
      .where("year", "==", fromYear)
      .get();

    if (balancesSnap.empty) {
      return NextResponse.json({ ok: true, processed: 0, message: `No EL balances found for ${fromYear}` });
    }

    const batch = db.batch();
    let processed = 0;
    const now = new Date();

    for (const doc of balancesSnap.docs) {
      const bal = doc.data() as LeaveBalanceV2;
      const uid = bal.uid;

      // Carry-forward = remaining balance capped at 300
      const remaining = Math.max(0, (bal.opening ?? 0) + (bal.credited ?? 0) - (bal.used ?? 0) - (bal.pending ?? 0));
      const carryForward = Math.min(EL_CARRY_CAP, remaining);

      // Compute next year's fresh entitlement
      let freshEntitlement = 0;
      if (elType) {
        const profileSnap = await PROFILES_COL(collegeId, db).doc(uid).get();
        if (profileSnap.exists) {
          const profile = profileSnap.data() as Parameters<typeof computeEntitlement>[1];
          freshEntitlement = computeEntitlement(elType, profile, toYear);
        }
      }

      const toDocId = balanceDocId(uid, EL_CODE, toYear);
      const toRef = LEAVE_COL(collegeId, db).doc(toDocId);
      const toSnap = await toRef.get();

      if (!toSnap.exists) {
        // Create next-year balance with carry-forward as opening
        batch.set(toRef, {
          uid,
          collegeId,
          leaveTypeCode: EL_CODE,
          year: toYear,
          opening: carryForward,
          carriedForward: carryForward,
          credited: freshEntitlement,
          used: 0,
          pending: 0,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        // Already exists — update opening with carry-forward (idempotent re-run)
        batch.update(toRef, {
          opening: carryForward,
          carriedForward: carryForward,
          updatedAt: now,
        });
      }

      processed++;
    }

    await batch.commit();

    return NextResponse.json({
      ok: true,
      processed,
      fromYear,
      toYear,
      message: `Carry-forward complete: ${processed} employee(s) processed for EL ${fromYear}→${toYear}.`,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/carry-forward POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
