export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOverlappingRegulationBatches } from "@/lib/college/academicSession";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Courses are managed by the Principal / VP / College Admin and by the
    // Dean Academics (ACADEMICS), who can change every field of a course.
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const { id } = await params;
    const body = (await readJsonBody(request)) as {
      name?: string;
      code?: string;
      durationYears?: number;
      isActive?: boolean;
      regulations?: string[];
      regulationBatches?: Record<string, string>;
      regulationDocumentUrls?: Record<string, string>;
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
      updates.regulations = Array.from(new Set(body.regulations.map((r) => r.trim()).filter(Boolean)));
    }

    if (body.regulationBatches != null) {
      for (const [reg, ranges] of Object.entries(body.regulationBatches)) {
        if (!/^\d{4}-\d{4}(,\d{4}-\d{4})*$/.test(ranges.trim())) {
          return NextResponse.json(
            { error: `Invalid batch range for regulation "${reg}" - expected "YYYY-YYYY" comma-separated` },
            { status: 400 }
          );
        }
      }
      const conflicts = findOverlappingRegulationBatches(body.regulationBatches);
      if (conflicts.length > 0) {
        const first = conflicts[0];
        return NextResponse.json(
          { error: `Batch ${first.year} is claimed by more than one regulation (${first.regulations.join(", ")}) - each admission year can only belong to one regulation.` },
          { status: 400 }
        );
      }
      updates.regulationBatches = body.regulationBatches;
    }

    // Merged key-by-key (dot-notation), not replaced wholesale like
    // regulations/regulationBatches above - a single-regulation upload from
    // Academics > Regulation must never wipe out another regulation's
    // already-uploaded document just because this request didn't mention it.
    if (body.regulationDocumentUrls != null) {
      for (const [reg, url] of Object.entries(body.regulationDocumentUrls)) {
        updates[`regulationDocumentUrls.${reg}`] = url;
      }
    }

    await ref.update(updates);

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    await writeAuditLogSafe(db, session.collegeId, { action: "COURSE_CATALOG_UPDATED" as string, performedBy: session.uid, performedByName: (actorSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Unknown", targetId: id, details: {
        name: (snap.data() as { name?: string }).name ?? "",
        changed: Object.keys(updates).filter((k) => k !== "updatedAt"),
      } });

    return NextResponse.json({ success: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
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
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
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

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    await writeAuditLogSafe(db, session.collegeId, { action: "COURSE_CATALOG_DELETED" as string, performedBy: session.uid, performedByName: (actorSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Unknown", targetId: id, details: { name: (snap.data() as { name?: string }).name ?? "" } });

    return NextResponse.json({ success: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[course-catalog/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
