export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadAcademicRegulations } from "@/lib/firestore/academicRegulations";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      code?: string;
      durationYears?: number;
      isActive?: boolean;
      regulations?: string[];
    };

    const db = getAdminDb();
    const catalogCol = db.collection("colleges").doc(session.collegeId).collection("courseCatalog");
    const ref = catalogCol.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const nextName = body.name != null ? body.name.trim() : undefined;
    const nextCode = body.code != null ? body.code.toUpperCase().trim() : undefined;

    if (nextName === "" || nextCode === "") {
      return NextResponse.json({ error: "name and code cannot be empty" }, { status: 400 });
    }

    // Guard the same-college name/code uniqueness on rename too.
    if (nextName != null || nextCode != null) {
      const all = await catalogCol.get();
      const nameKey = nextName?.toLowerCase();
      const clash = all.docs.find((d) => {
        if (d.id === id) return false;
        const data = d.data() as { name?: string; code?: string };
        return (nameKey != null && (data.name ?? "").trim().toLowerCase() === nameKey)
          || (nextCode != null && (data.code ?? "").trim().toUpperCase() === nextCode);
      });
      if (clash) {
        return NextResponse.json({ error: "A course with this name or code already exists" }, { status: 409 });
      }
    }

    if (nextName != null) updates.name = nextName;
    if (nextCode != null) updates.code = nextCode;
    if (body.durationYears != null) {
      if (body.durationYears < 1 || body.durationYears > 10) {
        return NextResponse.json({ error: "durationYears must be between 1 and 10" }, { status: 400 });
      }
      updates.durationYears = Number(body.durationYears);
    }
    if (body.isActive != null) updates.isActive = body.isActive;
    if (body.regulations != null) {
      const regulations = Array.from(new Set(body.regulations.map((r) => r.trim()).filter(Boolean)));
      if (regulations.length > 0) {
        const { regulations: declared } = await loadAcademicRegulations(db, session.collegeId);
        const invalid = regulations.filter((r) => !declared.includes(r));
        if (invalid.length > 0) {
          return NextResponse.json(
            { error: `Not declared under Settings > Academic Regulations: ${invalid.join(", ")}` },
            { status: 400 },
          );
        }
      }
      updates.regulations = regulations;
    }

    await ref.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[course-catalog/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("courseCatalog").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Block deletion while any department course was created from this catalog
    // entry - otherwise those courses lose their source of truth.
    const inUse = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courses")
      .where("catalogId", "==", id)
      .limit(1)
      .get();
    if (!inUse.empty) {
      return NextResponse.json(
        { error: "This course is in use by a department. Deactivate it instead of deleting." },
        { status: 409 }
      );
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[course-catalog/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
