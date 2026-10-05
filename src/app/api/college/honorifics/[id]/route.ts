export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { honorificKey } from "@/lib/honorifics/config";
import { MANAGE_ROLES } from "../route";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember(...MANAGE_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { name?: string; isActive?: boolean };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("honorifics").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const nextName = body.name != null ? body.name.trim() : undefined;
    if (nextName === "") {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    if (nextName != null) {
      const coll = db.collection("colleges").doc(session.collegeId).collection("honorifics");
      const all = await coll.get();
      const nameKey = honorificKey(nextName);
      const clash = all.docs.find((d) => d.id !== id && honorificKey((d.data() as { name?: string }).name) === nameKey);
      if (clash) return NextResponse.json({ error: "An honorific with this name already exists" }, { status: 409 });
      updates.name = nextName;
    }

    if (body.isActive != null) updates.isActive = body.isActive;

    await ref.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[honorifics/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember(...MANAGE_ROLES);
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("honorifics").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[honorifics/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
