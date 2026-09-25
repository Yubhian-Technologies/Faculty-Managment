export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// PRINCIPAL/VICE_PRINCIPAL manage this for their own college; HOD/COLLEGE_OFFICE
// read it (read-only) to auto-fill a section's admission batch; SUPER_ADMIN
// for any college (via `?collegeId=`). requireCollegeContext resolves collegeId
// from the session (Principal/VP) or the query param (Super Admin).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE");
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
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as { label?: string; isCurrent?: boolean };
    const label = body.label?.trim();

    if (!label) {
      return NextResponse.json({ error: "label is required, e.g. \"2025-26\"" }, { status: 400 });
    }

    const db = getAdminDb();
    const collection = db.collection("colleges").doc(session.collegeId).collection("academicSessions");
    const now = new Date();
    const isCurrent = body.isCurrent ?? false;

    // Transactional: the duplicate-label check and the single-isCurrent
    // invariant both need to read-then-write atomically, otherwise two
    // concurrent requests can each pass the pre-write check and both commit
    // (e.g. two `isCurrent:true` sessions ending up live at once).
    const newId = await db.runTransaction(async (tx) => {
      const existing = await tx.get(collection.where("label", "==", label).limit(1));
      if (!existing.empty) {
        throw new Error("DUPLICATE_LABEL");
      }
      if (isCurrent) {
        const current = await tx.get(collection.where("isCurrent", "==", true));
        for (const d of current.docs) tx.update(d.ref, { isCurrent: false, updatedAt: now });
      }
      const ref = collection.doc();
      tx.set(ref, {
        collegeId: session.collegeId,
        label,
        isCurrent,
        createdAt: now,
        updatedAt: now,
      });
      return ref.id;
    });

    return NextResponse.json({ id: newId }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "DUPLICATE_LABEL") {
      return NextResponse.json({ error: "Academic session already exists" }, { status: 409 });
    }
    console.error("[college/academic-sessions POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as { id?: string; isCurrent?: boolean };

    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collection = db.collection("colleges").doc(session.collegeId).collection("academicSessions");
    const ref = collection.doc(body.id);
    const now = new Date();

    // Transactional for the same reason as POST — the "unset every other
    // isCurrent doc, set this one" sequence must be atomic.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new Error("NOT_FOUND");
      }
      if (body.isCurrent) {
        const current = await tx.get(collection.where("isCurrent", "==", true));
        for (const d of current.docs) {
          if (d.id !== body.id) tx.update(d.ref, { isCurrent: false, updatedAt: now });
        }
        tx.update(ref, { isCurrent: true, updatedAt: now });
      } else {
        tx.update(ref, { isCurrent: false, updatedAt: now });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[college/academic-sessions PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL");
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
