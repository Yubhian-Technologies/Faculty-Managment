export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { text?: string; isActive?: boolean };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.text !== undefined) {
      const text = body.text.trim();
      if (!text) return NextResponse.json({ error: "text cannot be empty" }, { status: 400 });
      updates.text = text;
    }
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("hiringTermsTemplates").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Record not found. It may have been deleted." }, { status: 404 });
    }

    await ref.update(updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[hiring-terms/[id] PATCH]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
