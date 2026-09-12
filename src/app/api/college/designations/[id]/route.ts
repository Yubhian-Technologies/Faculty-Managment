export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { MANAGE_ROLES_BY_CATEGORY } from "../route";
import type { DesignationCadre, DesignationCategory } from "@/types";

const CADRES: DesignationCadre[] = ["PROFESSOR", "ASSOCIATE_PROFESSOR", "ASSISTANT_PROFESSOR"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE");
    const { id } = await params;
    const body = (await request.json()) as { name?: string; isActive?: boolean; cadre?: string | null };

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("designations");
    const ref = coll.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = snap.data() as { category: DesignationCategory; name: string };

    if (!MANAGE_ROLES_BY_CATEGORY[existing.category].includes(session.role)) {
      return NextResponse.json({ error: "You cannot manage this category's designations" }, { status: 403 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const nextName = body.name != null ? body.name.trim() : undefined;
    if (nextName === "") {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    if (nextName != null) {
      const all = await coll.where("category", "==", existing.category).get();
      const nameKey = nextName.toLowerCase();
      const clash = all.docs.find((d) => d.id !== id && ((d.data() as { name?: string }).name ?? "").trim().toLowerCase() === nameKey);
      if (clash) return NextResponse.json({ error: "A designation with this name already exists" }, { status: 409 });
      updates.name = nextName;
    }

    if (body.isActive != null) updates.isActive = body.isActive;

    if (body.cadre !== undefined) {
      if (body.cadre === null || body.cadre === "") {
        updates.cadre = null;
      } else if (existing.category === "FACULTY" && CADRES.includes(body.cadre as DesignationCadre)) {
        updates.cadre = body.cadre;
      } else {
        return NextResponse.json({ error: "Invalid cadre" }, { status: 400 });
      }
    }

    await ref.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[designations/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("designations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = snap.data() as { category: DesignationCategory; name: string };

    if (!MANAGE_ROLES_BY_CATEGORY[existing.category].includes(session.role)) {
      return NextResponse.json({ error: "You cannot manage this category's designations" }, { status: 403 });
    }

    // Block deletion while any Faculty/Supporting Staff record currently uses
    // this exact designation name - otherwise those records lose their source
    // of truth.
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const inUseSnap = await (existing.category === "FACULTY"
      ? collegeRef.collection("facultyMembers")
      : collegeRef.collection("supportingStaff")
    ).where("designation", "==", existing.name).limit(1).get();
    if (!inUseSnap.empty) {
      return NextResponse.json(
        { error: "This designation is in use. Deactivate it instead of deleting." },
        { status: 409 }
      );
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[designations/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
