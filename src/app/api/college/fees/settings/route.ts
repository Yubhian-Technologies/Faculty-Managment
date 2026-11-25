export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { feeRefs, loadSettings } from "@/lib/fees/server";
import { defaultCategory, normType } from "@/lib/fees/rules";
import type { FeeCategory } from "@/types/fees";

// Accounts > Fees > Setup > Categories (?collegeId): which fee category each admission type on the student records
// belongs to - A (Convenor / counselling; FR or NFR), SPOT (Category A fee, paid by the student), B (Management).
// GET: the mapping + every admission type on the college's students (with the default guess).
// PUT { categoryOf: { "CONVENOR": "A", ... } }

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const [settings, students] = await Promise.all([loadSettings(db, session.collegeId), feeRefs(db, session.collegeId).college.collection("students").select("admissionType").get()]);
    const counts = new Map<string, number>();
    for (const d of students.docs) { const t = normType(d.get("admissionType")); counts.set(t, (counts.get(t) ?? 0) + 1); }
    const types = [...counts].sort((a, b) => b[1] - a[1]).map(([type, students]) => ({ type, students, guess: type ? defaultCategory(type) : null }));
    return NextResponse.json({ settings, types });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/settings GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const body = (await readJsonBody(request)) as { categoryOf?: unknown };
    const raw = (body.categoryOf && typeof body.categoryOf === "object" ? body.categoryOf : {}) as Record<string, unknown>;
    const categoryOf: Record<string, FeeCategory> = {};
    for (const [k, v] of Object.entries(raw).slice(0, 100)) {
      const t = normType(k);
      if (t && (v === "A" || v === "B" || v === "SPOT")) categoryOf[t] = v;
    }
    const at = new Date().toISOString();
    await feeRefs(db, session.collegeId).settings.set({ categoryOf, updatedAt: at, updatedByName: session.byName });
    await writeAuditLogSafe(db, session.collegeId, { action: "FEE_CATEGORIES_SET", performedBy: session.uid, performedByName: session.byName, targetId: "feeSettings", details: { categoryOf } });
    return NextResponse.json({ settings: { categoryOf, updatedAt: at, updatedByName: session.byName } });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/settings PUT]");
  }
}
