export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { serializePage } from "@/lib/customNav/store";
import { pageMetaSchema } from "@/lib/customNav/validate";

const MAX_PAGES_PER_COLLEGE = 100;

// Super Admin: create a custom page (empty - blocks are added in the editor).
export async function POST(request: Request) {
  try {
    const session = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as { collegeId?: string } | null;
    const parsed = pageMetaSchema.safeParse(body);
    if (!body?.collegeId || !parsed.success) {
      return NextResponse.json({ error: parsed.success ? "collegeId is required" : parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(body.collegeId);
    if (!(await collegeRef.get()).exists) return NextResponse.json({ error: "College not found" }, { status: 404 });
    const existing = await collegeRef.collection("customPages").count().get();
    if (existing.data().count >= MAX_PAGES_PER_COLLEGE) {
      return NextResponse.json({ error: `A college can have at most ${MAX_PAGES_PER_COLLEGE} custom pages` }, { status: 400 });
    }

    const now = new Date();
    const ref = collegeRef.collection("customPages").doc();
    const data = {
      collegeId: body.collegeId, ...parsed.data, section: parsed.data.section ?? null, blocks: [],
      createdAt: now, updatedAt: now, updatedByName: session.email || "Super Admin",
    };
    await ref.set(data);
    await db.collection("auditLogs").add({
      action: "CUSTOM_PAGE_CREATED", performedBy: session.uid, performedByName: session.email || "Super Admin",
      details: { collegeId: body.collegeId, pageId: ref.id, title: parsed.data.title }, timestamp: now,
    });
    return NextResponse.json({ page: serializePage(ref.id, data) }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[admin/custom-nav/pages POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
