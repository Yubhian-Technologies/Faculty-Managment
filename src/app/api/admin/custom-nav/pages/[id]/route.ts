export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { layoutRef, pageRef, serializePage, visibilityRef } from "@/lib/customNav/store";
import { pageUpdateSchema } from "@/lib/customNav/validate";
import { customPageHref, ROLE_LABELS } from "@/types";

type Ctx = { params: Promise<{ id: string }> };

function collegeIdOf(request: Request): string | null {
  return new URL(request.url).searchParams.get("collegeId");
}

// Super Admin: one page including its blocks (editor + preview).
export async function GET(request: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const collegeId = collegeIdOf(request);
    if (!collegeId) return NextResponse.json({ error: "collegeId is required" }, { status: 400 });
    const snap = await pageRef(getAdminDb(), collegeId, id).get();
    if (!snap.exists) return NextResponse.json({ error: "Page not found" }, { status: 404 });
    return NextResponse.json({ page: serializePage(snap.id, snap.data()!) });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[admin/custom-nav/pages/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Super Admin: save a page (settings and blocks together).
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const session = await requireSuperAdmin();
    const { id } = await params;
    const collegeId = collegeIdOf(request);
    if (!collegeId) return NextResponse.json({ error: "collegeId is required" }, { status: 400 });
    const parsed = pageUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid page" }, { status: 400 });

    const db = getAdminDb();
    const ref = pageRef(db, collegeId, id);
    if (!(await ref.get()).exists) return NextResponse.json({ error: "Page not found" }, { status: 404 });
    const now = new Date();
    await ref.set({ ...parsed.data, section: parsed.data.section ?? null, collegeId, updatedAt: now, updatedByName: session.email || "Super Admin" }, { merge: true });
    await db.collection("auditLogs").add({
      action: "CUSTOM_PAGE_UPDATED", performedBy: session.uid, performedByName: session.email || "Super Admin",
      details: { collegeId, pageId: id, title: parsed.data.title, enabled: parsed.data.enabled, blocks: parsed.data.blocks.length }, timestamp: now,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[admin/custom-nav/pages/[id] PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Super Admin: delete a page and tidy every place that referenced its tab
// (saved orders and the per-role hidden lists).
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const session = await requireSuperAdmin();
    const { id } = await params;
    const collegeId = collegeIdOf(request);
    if (!collegeId) return NextResponse.json({ error: "collegeId is required" }, { status: 400 });

    const db = getAdminDb();
    const ref = pageRef(db, collegeId, id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const href = customPageHref(id);
    const roles = Object.keys(ROLE_LABELS);
    const [layoutSnap, visSnap] = await Promise.all([layoutRef(db, collegeId).get(), visibilityRef(db, collegeId).get()]);
    const batch = db.batch();
    batch.delete(ref);
    if (layoutSnap.exists) {
      const order = (layoutSnap.data()?.order ?? {}) as Record<string, string[]>;
      const updates: Record<string, unknown> = {};
      for (const r of roles) if (order[r]?.includes(href)) updates[`order.${r}`] = order[r].filter((h) => h !== href);
      if (Object.keys(updates).length) batch.update(layoutRef(db, collegeId), updates);
    }
    if (visSnap.exists) {
      const hidden = (visSnap.data()?.hiddenItems ?? {}) as Record<string, string[]>;
      const updates: Record<string, unknown> = {};
      for (const r of roles) if (hidden[r]?.includes(href)) updates[`hiddenItems.${r}`] = FieldValue.arrayRemove(href);
      if (Object.keys(updates).length) batch.update(visibilityRef(db, collegeId), updates);
    }
    await batch.commit();
    await db.collection("auditLogs").add({
      action: "CUSTOM_PAGE_DELETED", performedBy: session.uid, performedByName: session.email || "Super Admin",
      details: { collegeId, pageId: id, title: snap.data()?.title }, timestamp: new Date(),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[admin/custom-nav/pages/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
