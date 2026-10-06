export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { getAdminDb } from "@/lib/firebase/admin";
import { authorizedSection } from "@/lib/students/sectionInchargeAuth";
import { LAB_BATCH_SETTINGS, labBatchSettingId, normalizeBatch } from "@/lib/students/labBatchMode";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { LAB_FACULTY_WINDOWS, labWindowId, normalizeWindows } from "@/lib/students/labFacultyWindow";
import type { Section, SectionLabBatchSetting, SectionLabFacultyWindows, TeachingAssignment } from "@/types";

// The labs of one section, and whether each runs batch by batch or with no batch
// (the whole section together) - see SectionLabBatchSetting. The section's
// faculty incharge decides it (Students -> Lab Batches), after assigning the lab
// batches; its HOD may too.
const ROLES = ["PANEL_MEMBER", "HOD"] as const;

interface LabInfo {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  /** The lab's current faculty in this section (one assignment each). */
  faculty: { facultyId: string; facultyName: string }[];
}

/** The distinct lab (PRACTICAL) subjects currently taught in the section, with the faculty teaching each. */
async function labsOfSection(collegeId: string, sectionId: string): Promise<LabInfo[]> {
  const db = getAdminDb();
  const collegeRef = db.collection("colleges").doc(collegeId);
  const snap = await collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get();
  const current = snap.docs.map((d) => d.data() as TeachingAssignment).filter((a) => !a.isPast && a.subjectId);
  const subjectIds = Array.from(new Set(current.map((a) => a.subjectId)));
  if (subjectIds.length === 0) return [];
  const subjectSnaps = await db.getAll(...subjectIds.map((id) => collegeRef.collection("subjects").doc(id)));
  return subjectSnaps
    .filter((s) => s.exists && (s.data() as { type?: string }).type === "PRACTICAL")
    .map((s) => {
      const d = s.data() as { name?: string; code?: string };
      const seen = new Set<string>();
      const faculty = current
        .filter((a) => a.subjectId === s.id && a.facultyId && !seen.has(a.facultyId) && !!seen.add(a.facultyId))
        .map((a) => ({ facultyId: a.facultyId, facultyName: a.facultyName ?? "" }))
        .sort((x, y) => x.facultyName.localeCompare(y.facultyName));
      return { subjectId: s.id, subjectName: d.name ?? "", subjectCode: d.code ?? "", faculty };
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

/** The lab batch labels set up for this section (saved list + whatever students carry), de-duplicated case-insensitively. */
async function batchesOfSection(collegeId: string, section: Section): Promise<string[]> {
  const db = getAdminDb();
  const students = await fetchSectionStudents(db.collection("colleges").doc(collegeId), {
    department: section.department, sectionName: section.name, year: section.year, courseId: section.courseId,
  });
  const byKey = new Map<string, string>();
  // The batches set up for the section, even ones no student is in yet...
  for (const label of section.labBatches ?? []) {
    const l = label.trim();
    if (l && !byKey.has(normalizeBatch(l))) byKey.set(normalizeBatch(l), l);
  }
  // ...plus any a student already carries.
  for (const s of students) {
    const label = (s.labBatch ?? "").trim();
    if (label && !byKey.has(normalizeBatch(label))) byKey.set(normalizeBatch(label), label);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const sectionId = new URL(request.url).searchParams.get("sectionId");
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    const auth = await authorizedSection(session, sectionId);
    if ("error" in auth) return auth.error;

    const db = getAdminDb();
    const [labs, batches] = await Promise.all([labsOfSection(session.collegeId, sectionId), batchesOfSection(session.collegeId, auth.section)]);
    const col = db.collection("colleges").doc(session.collegeId).collection(LAB_BATCH_SETTINGS);
    const snaps = labs.length > 0 ? await db.getAll(...labs.map((l) => col.doc(labBatchSettingId(sectionId, l.subjectId)))) : [];
    const settingBySubject = new Map(
      snaps.filter((s) => s.exists).map((s) => [(s.data() as SectionLabBatchSetting).subjectId, s.data() as SectionLabBatchSetting]),
    );
    const winCol = db.collection("colleges").doc(session.collegeId).collection(LAB_FACULTY_WINDOWS);
    const winSnaps = labs.length > 0 ? await db.getAll(...labs.map((l) => winCol.doc(labWindowId(sectionId, l.subjectId)))) : [];
    const windowsBySubject = new Map(
      winSnaps.filter((s) => s.exists).map((s) => [(s.data() as SectionLabFacultyWindows).subjectId, (s.data() as SectionLabFacultyWindows).windowByFaculty ?? {}]),
    );
    return NextResponse.json({
      batches,
      labs: labs.map((l) => {
        const setting = settingBySubject.get(l.subjectId);
        return {
          subjectId: l.subjectId,
          subjectName: l.subjectName,
          subjectCode: l.subjectCode,
          // null = no decision yet (the lab keeps behaving as scheduled).
          batchWise: setting ? setting.batchWise : null,
          faculty: l.faculty.map((f) => ({
            ...f,
            batch: setting?.batchByFaculty?.[f.facultyId] ?? null,
            // The dates this faculty teaches the lab; null = throughout.
            window: windowsBySubject.get(l.subjectId)?.[f.facultyId] ?? null,
          })),
        };
      }),
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/section-lab-batch-settings GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as {
      sectionId?: string; subjectId?: string; batchWise?: boolean | null; batchByFaculty?: Record<string, string | null>;
      // Each faculty's teaching dates for this lab (empty/absent = throughout). Replaced whole when sent.
      windowByFaculty?: Record<string, { from?: string | null; to?: string | null } | null>;
    };
    const sectionId = body.sectionId?.trim();
    const subjectId = body.subjectId?.trim();
    if (!sectionId || !subjectId) return NextResponse.json({ error: "sectionId and subjectId are required" }, { status: 400 });
    if (body.batchWise !== undefined && body.batchWise !== null && typeof body.batchWise !== "boolean") {
      return NextResponse.json({ error: "batchWise must be true, false or null" }, { status: 400 });
    }
    // Only the dates changed: the batch settings are left exactly as they are.
    const windowsOnly = body.batchWise === undefined;
    if (windowsOnly && !body.windowByFaculty) {
      return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
    }
    const auth = await authorizedSection(session, sectionId);
    if ("error" in auth) return auth.error;

    const labs = await labsOfSection(session.collegeId, sectionId);
    const lab = labs.find((l) => l.subjectId === subjectId);
    if (!lab) {
      return NextResponse.json({ error: "That is not a lab of this section" }, { status: 404 });
    }

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection(LAB_BATCH_SETTINGS).doc(labBatchSettingId(sectionId, subjectId));

    // Teaching dates per faculty: only for faculty of this lab, real dates, no overlaps.
    let windows: Record<string, { from: string; to: string }> | undefined;
    if (body.windowByFaculty) {
      const labFacultyIds = new Set(lab.faculty.map((f) => f.facultyId));
      if (Object.keys(body.windowByFaculty).some((id) => !labFacultyIds.has(id))) {
        return NextResponse.json({ error: "That faculty does not teach this lab in this section" }, { status: 400 });
      }
      const normalized = normalizeWindows(body.windowByFaculty);
      if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
      windows = normalized.windows;
    }

    // Which batch each faculty takes - only for a batch-wise lab. Omitted = leave what is saved.
    let batchByFaculty: Record<string, string> | undefined;
    if (windowsOnly) {
      batchByFaculty = undefined;
    } else if (body.batchWise === false) {
      batchByFaculty = {};
    } else if (body.batchWise === true && body.batchByFaculty) {
      const available = new Map((await batchesOfSection(session.collegeId, auth.section)).map((b) => [normalizeBatch(b), b]));
      const labFacultyIds = new Set(lab.faculty.map((f) => f.facultyId));
      batchByFaculty = {};
      for (const [facultyId, raw] of Object.entries(body.batchByFaculty)) {
        const wanted = typeof raw === "string" ? raw.trim() : "";
        if (!wanted) continue; // no batch of their own
        if (!labFacultyIds.has(facultyId)) {
          return NextResponse.json({ error: "That faculty does not teach this lab in this section" }, { status: 400 });
        }
        const canonical = available.get(normalizeBatch(wanted));
        if (!canonical) {
          return NextResponse.json({ error: `"${wanted}" is not a batch of this section - add it under Divide into batches first` }, { status: 400 });
        }
        batchByFaculty[facultyId] = canonical;
      }
    }

    if (windows) {
      const winRef = db.collection("colleges").doc(session.collegeId).collection(LAB_FACULTY_WINDOWS).doc(labWindowId(sectionId, subjectId));
      if (Object.keys(windows).length === 0) {
        await winRef.delete();
      } else {
        await winRef.set({
          collegeId: session.collegeId, sectionId, subjectId, windowByFaculty: windows,
          updatedBy: session.uid, updatedAt: new Date(),
        } satisfies Omit<SectionLabFacultyWindows, "id">);
      }
    }

    if (windowsOnly) {
      // dates only - the batch decision is untouched
    } else if (body.batchWise === null) {
      await ref.delete();
    } else if (typeof body.batchWise === "boolean") {
      const data = {
        collegeId: session.collegeId,
        sectionId,
        subjectId,
        batchWise: body.batchWise,
        ...(batchByFaculty ? { batchByFaculty } : {}),
        updatedBy: session.uid,
        updatedAt: new Date(),
      } satisfies Omit<SectionLabBatchSetting, "id">;
      // A mapping is replaced whole (a merge would keep a faculty whose batch was just cleared);
      // without one, only the mode changes and the saved mapping stays.
      if (batchByFaculty) await ref.set(data);
      else await ref.set(data, { merge: true });
    }
    await writeAuditLogSafe(db, session.collegeId, {
      action: "LAB_BATCH_MODE_SET",
      performedBy: session.uid,
      performedByName: session.email || session.role,
      targetId: ref.id,
      details: { sectionId, subjectId, batchWise: body.batchWise ?? null, batchByFaculty: batchByFaculty ?? null, windowByFaculty: windows ?? null },
    });
    return NextResponse.json({ ok: true, batchWise: body.batchWise ?? null, windowByFaculty: windows ?? null });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/section-lab-batch-settings PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
