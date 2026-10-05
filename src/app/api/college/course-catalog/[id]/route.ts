export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOverlappingRegulationBatches } from "@/lib/college/academicSession";
import { cascadeCourseRename, courseSyncPatches, findShrinkBlocker, type CatalogValues } from "@/lib/college/catalogSync";
import { MAX_COURSE_DURATION_YEARS } from "@/lib/college/courseYears";
import { FieldValue } from "firebase-admin/firestore";

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
      if (body.durationYears < 1 || body.durationYears > MAX_COURSE_DURATION_YEARS) {
        return NextResponse.json({ error: `durationYears must be between 1 and ${MAX_COURSE_DURATION_YEARS}` }, { status: 400 });
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

    // Every department's Course doc stores a COPY of this entry's name / code / length (see catalogSync.ts).
    // When any of them is being saved, bring those copies in step in the SAME atomic batch as the catalog
    // write - and refuse first if shortening the course would strand data. Saving values that are already
    // right is harmless, and also repairs a copy that drifted earlier.
    const prev = snap.data() as Partial<CatalogValues> & { cascadeStatus?: string; cascadeOldName?: string };
    const touchesCopies = nextName != null || nextCode != null || body.durationYears != null;
    let syncedCourses = 0;
    let renameFrom: string | null = null;
    let renamedCourseIds: string[] = [];
    if (touchesCopies) {
      const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").where("catalogId", "==", id).get();
      const courseDocs = courseSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { departmentId?: string; name?: string; code?: string; durationYears?: number }) }));
      renamedCourseIds = courseDocs.map((c) => c.id);

      const nextDuration = body.durationYears != null ? Number(body.durationYears) : undefined;
      if (nextDuration !== undefined) {
        const longest = Math.max(Number(prev.durationYears) || 0, ...courseDocs.map((c) => Number(c.durationYears) || 0));
        const blocker = await findShrinkBlocker(db, session.collegeId, id, courseDocs, longest, nextDuration);
        if (blocker) return NextResponse.json({ error: blocker, code: "COURSE_YEARS_IN_USE" }, { status: 409 });
      }

      const patches = courseSyncPatches(courseDocs, { name: nextName, code: nextCode, durationYears: nextDuration });
      syncedCourses = patches.length;
      if (nextName != null && nextName !== prev.name && prev.name) renameFrom = prev.name;
      // A rename that failed part-way earlier is retried by saving the same name again.
      if (!renameFrom && nextName != null && prev.cascadeStatus === "FAILED" && prev.cascadeOldName && prev.cascadeOldName !== nextName) {
        renameFrom = prev.cascadeOldName;
      }

      const col = db.collection("colleges").doc(session.collegeId).collection("courses");
      if (patches.length + 1 <= 450) {
        const batch = db.batch();
        batch.update(ref, updates);
        for (const p of patches) batch.update(col.doc(p.id), { ...p.patch, updatedAt: new Date() });
        await batch.commit();
      } else {
        await ref.update(updates);
        for (let i = 0; i < patches.length; i += 400) {
          const batch = db.batch();
          for (const p of patches.slice(i, i + 400)) batch.update(col.doc(p.id), { ...p.patch, updatedAt: new Date() });
          await batch.commit();
        }
      }
    } else {
      await ref.update(updates);
    }

    // Live copies of the name (student lists filter on it) - see cascadeCourseRename.
    let cascade: { status: "DONE" | "FAILED"; failedStep?: string; error?: string } | undefined;
    if (renameFrom && nextName) {
      const result = await cascadeCourseRename(db, session.collegeId, renamedCourseIds, renameFrom, nextName);
      cascade = result.failedStep ? { status: "FAILED", failedStep: result.failedStep, error: result.error } : { status: "DONE" };
      await ref.update(
        cascade.status === "FAILED"
          ? { cascadeStatus: "FAILED", cascadeOldName: renameFrom, cascadeError: `${cascade.failedStep}: ${cascade.error}`, cascadeUpdatedAt: new Date() }
          : { cascadeStatus: "DONE", cascadeOldName: FieldValue.delete(), cascadeError: FieldValue.delete(), cascadeUpdatedAt: new Date() }
      ).catch((e) => console.error("[course-catalog/[id] PATCH] couldn't record cascade status:", e));
      if (cascade.status === "FAILED") console.error(`[course-catalog/[id] PATCH] name cascade for ${id} stopped at ${cascade.failedStep}: ${cascade.error}`);
    }

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    await writeAuditLogSafe(db, session.collegeId, { action: "COURSE_CATALOG_UPDATED" as string, performedBy: session.uid, performedByName: (actorSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Unknown", targetId: id, details: {
        name: (snap.data() as { name?: string }).name ?? "",
        changed: Object.keys(updates).filter((k) => k !== "updatedAt"),
      } });

    return NextResponse.json({ success: true, coursesUpdated: syncedCourses, ...(cascade ? { cascade } : {}) });
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
