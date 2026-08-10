export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { countEntered } from "@/lib/exams/internalExamMarks";
import { resolveUserName } from "@/lib/budget/departmentScope";
import type { ExamConfiguration, InternalExamMarkEntry, InternalExamMarksBatch } from "@/types";

const PRINCIPAL_TIER_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember("PANEL_MEMBER", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const isPrincipalTier = PRINCIPAL_TIER_ROLES.includes(session.role);
    const body = (await request.json()) as {
      entries?: { studentId: string; componentMarks: Record<string, number | null> }[];
      submit?: boolean;
    };

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("internalExamMarks").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const existing = snap.data() as InternalExamMarksBatch;

    // Two entirely separate write paths share this endpoint:
    //  - the owning faculty, editing their own still-in-progress (DRAFT) batch
    //    and optionally submitting it — unchanged from before.
    //  - Principal/VP/Super Admin, correcting a batch the faculty has ALREADY
    //    submitted. HOD is never in PRINCIPAL_TIER_ROLES and has no path here
    //    at all — their access (see GET above) is read-only by construction,
    //    not by a check that could be bypassed.
    if (isPrincipalTier) {
      if (existing.status !== "SUBMITTED") {
        return NextResponse.json({ error: "Only already-submitted marks can be corrected here" }, { status: 409 });
      }
    } else {
      if (existing.facultyId !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (existing.status === "SUBMITTED") {
        return NextResponse.json({ error: "Marks have already been submitted and cannot be edited" }, { status: 409 });
      }
    }

    // The Exam Cell's configuration is re-fetched live on every save — it's
    // the single source of truth for which components exist and their
    // maximums, so a stale client can never write a value the current
    // configuration wouldn't allow.
    const configSnap = await collegeRef.collection("examConfigurations").doc(existing.subjectId).get();
    if (!configSnap.exists) {
      return NextResponse.json(
        { error: "This subject's internal exam configuration is no longer available. Contact your Exam Cell." },
        { status: 404 }
      );
    }
    const config = { id: configSnap.id, ...configSnap.data() } as ExamConfiguration;
    const componentsById = new Map(config.components.map((c) => [c.id, c]));

    let entries: InternalExamMarkEntry[] = existing.entries;
    // Per-student, per-component before/after values — only populated (and
    // only meaningful) for a Principal-tier correction of already-submitted
    // marks; a faculty member filling in their own draft has no prior value
    // worth auditing.
    const changes: { studentId: string; studentName: string; componentId: string; componentName: string; from: number | null; to: number | null }[] = [];
    if (body.entries) {
      const updates = new Map(body.entries.map((e) => [e.studentId, e.componentMarks]));
      for (const componentMarks of updates.values()) {
        for (const [componentId, marks] of Object.entries(componentMarks ?? {})) {
          if (marks === null) continue;
          const component = componentsById.get(componentId);
          // A component that's since been removed/renamed by the Exam Cell —
          // drop it below rather than trusting a stale client-sent value.
          if (!component) continue;
          if (typeof marks !== "number" || !Number.isFinite(marks) || marks < 0 || marks > component.maxMarks) {
            return NextResponse.json(
              { error: `${component.name} marks must be between 0 and ${component.maxMarks}` },
              { status: 400 }
            );
          }
        }
      }
      entries = existing.entries.map((e) => {
        const update = updates.get(e.studentId);
        if (!update) return e;
        // Only keep marks for components that still exist in the live config.
        const merged: Record<string, number | null> = { ...e.componentMarks };
        for (const [componentId, marks] of Object.entries(update)) {
          if (!componentsById.has(componentId)) continue;
          if (isPrincipalTier && (e.componentMarks[componentId] ?? null) !== marks) {
            changes.push({
              studentId: e.studentId,
              studentName: e.name,
              componentId,
              componentName: componentsById.get(componentId)!.name,
              from: e.componentMarks[componentId] ?? null,
              to: marks,
            });
          }
          merged[componentId] = marks;
        }
        return { ...e, componentMarks: merged };
      });
    }
    const enteredCount = countEntered(entries, config);

    const now = new Date();
    const update: Record<string, unknown> = { entries, enteredCount, updatedAt: now };

    let actorName = "";
    if (isPrincipalTier && changes.length > 0) {
      actorName = await resolveUserName(db, session.collegeId, session.uid);
      update.lastModifiedBy = session.uid;
      update.lastModifiedByName = actorName;
      update.lastModifiedAt = now;
    } else if (!isPrincipalTier && body.submit) {
      if (enteredCount < existing.totalStudents || existing.totalStudents === 0) {
        return NextResponse.json(
          { error: "Please enter marks for all students before submitting" },
          { status: 400 }
        );
      }
      update.status = "SUBMITTED";
      update.submittedAt = now;
    }

    await ref.update(update);

    // Audit trail for Principal-tier corrections — reuses this college's
    // existing auditLogs collection (see e.g. budget-requests, faculty
    // routes) rather than a new mechanism. One entry per save, carrying the
    // full before/after diff so a silent overwrite is never possible to miss.
    if (isPrincipalTier && changes.length > 0) {
      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "INTERNAL_EXAM_MARKS_CORRECTED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: id,
        details: {
          subjectName: existing.subjectName,
          sectionName: existing.sectionName,
          facultyName: existing.facultyName,
          changes,
        },
        timestamp: now,
      });
    }

    return NextResponse.json({
      batch: { ...existing, ...update, id },
      configuration: config,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/internal-exam-marks/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
