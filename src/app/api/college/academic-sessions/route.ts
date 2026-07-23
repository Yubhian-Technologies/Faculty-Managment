export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// PRINCIPAL/VICE_PRINCIPAL/HOD manage this for their own college; SUPER_ADMIN
// for any college (via `?collegeId=`). requireCollegeContext resolves collegeId
// from the session (Principal) or the query param (Super Admin).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const db = getAdminDb();

    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("academicSessions")
      .orderBy("label", "desc")
      .get();

    const academicSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ academicSessions });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-sessions GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL");
    const body = (await request.json()) as { label?: string; isCurrent?: boolean };
    const label = body.label?.trim();

    if (!label) {
      return NextResponse.json({ error: "label is required, e.g. \"2025-26\"" }, { status: 400 });
    }

    const db = getAdminDb();

    const collection = db.collection("colleges").doc(session.collegeId).collection("academicSessions");
    const existing = await collection.where("label", "==", label).limit(1).get();
    if (!existing.empty) {
      return NextResponse.json({ error: `Academic session "${label}" already exists` }, { status: 409 });
    }

    const now = new Date();
    const isCurrent = body.isCurrent ?? false;

    if (isCurrent) {
      const current = await collection.where("isCurrent", "==", true).get();
      const batch = db.batch();
      for (const d of current.docs) batch.update(d.ref, { isCurrent: false, updatedAt: now });
      await batch.commit();
    }

    const ref = await collection.add({
      collegeId: session.collegeId,
      label,
      isCurrent,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-sessions POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL");
    const body = (await request.json()) as { id?: string; isCurrent?: boolean };

    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const db = getAdminDb();

    const collection = db.collection("colleges").doc(session.collegeId).collection("academicSessions");
    const ref = collection.doc(body.id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date();

    if (body.isCurrent) {
      const current = await collection.where("isCurrent", "==", true).get();
      const batch = db.batch();
      for (const d of current.docs) {
        if (d.id !== body.id) batch.update(d.ref, { isCurrent: false, updatedAt: now });
      }
      batch.update(ref, { isCurrent: true, updatedAt: now });
      await batch.commit();
    } else {
      await ref.update({ isCurrent: false, updatedAt: now });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-sessions PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const db = getAdminDb();

    await db.collection("colleges").doc(session.collegeId).collection("academicSessions").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-sessions DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
