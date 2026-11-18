export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { sanitizeLeaveTypeRuleOverrides } from "@/lib/leave/resolveLeaveTypes";
import { groupLeavePolicyRef, invalidateGroupLeavePolicy, loadGroupLeavePolicy, sanitizeLocks } from "@/lib/leave/groupLeavePolicy";
import { notifyRole } from "@/lib/notify";
import type { GroupLeavePolicy } from "@/types/leave";

// Super Admin > Settings > Leave Policy (All Colleges): the group's leave rules (systemSettings/leavePolicy) - per
// leave type, group values (a college may change them) and locked fields (the same for every college).
// GET -> { policy }   PUT { rules, locked } -> { policy }
// Every change is kept with before / after in systemSettings/leavePolicy/history; each college's Principal is notified.

function fail(err: unknown, tag: string) {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof Error && err.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}

export async function GET() {
  try {
    await requireSuperAdmin();
    const policy = await loadGroupLeavePolicy(getAdminDb(), { fresh: true });
    return NextResponse.json({ policy: policy ?? { rules: {}, locked: {} } });
  } catch (err) {
    return fail(err, "admin/settings/leave-policy GET");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSuperAdmin();
    const body = (await readJsonBody(request)) as { rules?: unknown; locked?: unknown };
    const rules = sanitizeLeaveTypeRuleOverrides(body.rules ?? {});
    if (!rules.ok) return NextResponse.json({ error: rules.error }, { status: 400 });
    const locks = sanitizeLocks(body.locked, new Set(LEAVE_TYPE_SEED.map((t) => t.code)));
    if (!locks.ok) return NextResponse.json({ error: locks.error }, { status: 400 });

    const db = getAdminDb();
    const before = await loadGroupLeavePolicy(db, { fresh: true });
    const actor = (await db.collection("systemUsers").doc(session.uid).get()).data() as { name?: string } | undefined;
    const now = new Date();
    const policy: GroupLeavePolicy = { rules: rules.overrides, locked: locks.locked, updatedAt: now, updatedByName: actor?.name ?? "" };
    const ref = groupLeavePolicyRef(db);
    const batch = db.batch();
    batch.set(ref, policy);
    batch.set(ref.collection("history").doc(), {
      at: now, byUid: session.uid, byName: actor?.name ?? "",
      before: before ? { rules: before.rules, locked: before.locked } : null,
      after: { rules: policy.rules, locked: policy.locked },
    });
    await batch.commit();
    invalidateGroupLeavePolicy();

    // Every college's Principal is told (one notification each).
    const colleges = await db.collection("colleges").select().get();
    await Promise.all(colleges.docs.map((c) => notifyRole(db, c.id, "PRINCIPAL", "LEAVE_POLICY_CHANGED", "Leave policy updated",
      "The Super Admin changed the leave rules for all colleges. Locked rules show in Settings > Leave Policy.", "/principal/settings")));
    return NextResponse.json({ policy });
  } catch (err) {
    return fail(err, "admin/settings/leave-policy PUT");
  }
}
