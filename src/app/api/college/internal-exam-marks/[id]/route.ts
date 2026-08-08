export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { countEntered } from "@/lib/exams/internalExamMarks";
import type { ExamConfiguration, InternalExamMarkEntry, InternalExamMarksBatch } from "@/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember("PANEL_MEMBER");
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
    if (existing.facultyId !== session.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.status === "SUBMITTED") {
      return NextResponse.json({ error: "Marks have already been submitted and cannot be edited" }, { status: 409 });
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
          if (componentsById.has(componentId)) merged[componentId] = marks;
        }
        return { ...e, componentMarks: merged };
      });
    }
    const enteredCount = countEntered(entries, config);

    const now = new Date();
    const update: Record<string, unknown> = { entries, enteredCount, updatedAt: now };

    if (body.submit) {
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
