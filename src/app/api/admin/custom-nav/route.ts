export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { layoutRef, serializePage, toIso, toSummary } from "@/lib/customNav/store";
import { orderSchema } from "@/lib/customNav/validate";
import type { CustomNavLayout, CustomPageSummary } from "@/types";

// Super Admin: a college's custom pages (without their blocks) and saved tab order.
export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const collegeId = new URL(request.url).searchParams.get("collegeId");
    if (!collegeId) return NextResponse.json({ error: "collegeId is required" }, { status: 400 });

    const db = getAdminDb();
    const [pagesSnap, layoutSnap] = await Promise.all([
      db.collection("colleges").doc(collegeId).collection("customPages").get(),
      layoutRef(db, collegeId).get(),
    ]);
    const pages: CustomPageSummary[] = pagesSnap.docs
      .map((d) => toSummary(serializePage(d.id, d.data())))
      .sort((a, b) => a.title.localeCompare(b.title));
    const stored = layoutSnap.exists ? (layoutSnap.data() as { order?: CustomNavLayout["order"]; updatedAt?: unknown }) : undefined;
    const layout: CustomNavLayout = { order: stored?.order ?? {}, updatedAt: toIso(stored?.updatedAt as Date | undefined) };
    return NextResponse.json({ pages, layout });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[admin/custom-nav GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Super Admin: save one role's tab order (built-in and custom tabs together).
export async function PUT(request: Request) {
  try {
    const session = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as { collegeId?: string } | null;
    const parsed = orderSchema.safeParse(body);
    if (!body?.collegeId || !parsed.success) {
      return NextResponse.json({ error: parsed.success ? "collegeId is required" : parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    }
    const { role, order } = parsed.data;
    if (new Set(order).size !== order.length) return NextResponse.json({ error: "Order has duplicate tabs" }, { status: 400 });

    const db = getAdminDb();
    const now = new Date();
    const updatedByName = session.email || "Super Admin";
    await layoutRef(db, body.collegeId).set({ order: { [role]: order }, updatedAt: now, updatedByName }, { merge: true });
    await db.collection("auditLogs").add({
      action: "NAV_LAYOUT_UPDATED", performedBy: session.uid, performedByName: updatedByName,
      details: { collegeId: body.collegeId, role, count: order.length }, timestamp: now,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[admin/custom-nav PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
