export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { formatDocId, formatsCol } from "@/lib/midMarks/formatServer";
import { midMarksSheetsCol } from "@/lib/midMarks/server";
import { cleanComponents, formatLine, sameComponents } from "@/lib/midMarks/format";
import { MidMarksError } from "@/lib/midMarks/sheet";
import { midMarksErrorResponse } from "@/lib/midMarks/http";
import type { MidExamFormat, MidFormatComponent, MidMarksSheet } from "@/types/midMarks";
import type { Subject } from "@/types";

// Exam Cell > Mid Configuration > Marks > Mid Exam Format (lib/midMarks/format.ts): what a Mid exam is made of, per
// course + regulation ("ALL" = every regulation without its own), with subjects that have their own components.
// GET: every format + the regulations per course (Course Catalog).
// PUT { courseKey, courseName, regulation, components, subjectFormats: [{ subjectCode, components }] }
// DELETE ?id=
// A sheet keeps the components it was built on, so a change that would reshape a sheet with marks is refused (409).

export async function GET() {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER");
    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const [snap, catalog] = await Promise.all([formatsCol(db, session.collegeId).get(), college.collection("courseCatalog").get()]);
    const regulationsByCourse: Record<string, string[]> = {};
    for (const d of catalog.docs) {
      const regs = (d.get("regulations") as string[] | undefined) ?? [];
      regulationsByCourse[d.id] = [...new Set(regs.map((r) => String(r).trim().toUpperCase()).filter(Boolean))].sort();
    }
    const formats = snap.docs.map((d) => ({ ...(d.data() as Omit<MidExamFormat, "id">), id: d.id }))
      .sort((a, b) => a.courseName.localeCompare(b.courseName) || a.regulation.localeCompare(b.regulation));
    return NextResponse.json({ formats, regulationsByCourse });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-exam-formats GET]");
  }
}

/** Sheets (with marks) of the course whose components a new format would change. */
async function reshapedSheets(db: FirebaseFirestore.Firestore, c: string, courseKey: string, regulation: string, next: MidExamFormat | null): Promise<string[]> {
  const sheets = (await midMarksSheetsCol(db, c).where("courseKey", "==", courseKey).get()).docs
    .map((d) => d.data() as MidMarksSheet).filter((s) => s.format);
  if (!sheets.length) return [];
  const subjectIds = [...new Set(sheets.map((s) => s.subjectId))];
  const subs = await db.getAll(...subjectIds.map((id) => db.collection("colleges").doc(c).collection("subjects").doc(id)));
  const regOf = new Map(subs.map((s) => [s.id, String((s.data() as Subject | undefined)?.regulation ?? "").trim().toUpperCase()]));
  const hasMarks = (s: MidMarksSheet) => s.entries.some((e) => e.absent || (e.abParts?.length ?? 0) > 0 || Object.values(e.q).some((v) => v != null));
  return sheets.filter((s) => {
    const reg = regOf.get(s.subjectId) ?? "";
    // Only sheets this format decides: its own regulation, or ALL for a regulation without its own format.
    if (regulation !== "ALL" && reg !== regulation) return false;
    if (!hasMarks(s)) return false;
    const comps: MidFormatComponent[] | null = next ? next.subjectFormats?.[s.subjectId]?.components ?? next.components : null;
    return !comps || !sameComponents(comps, s.format!.components);
  }).map((s) => `${s.subjectCode ?? s.subjectName} ${s.sectionName} Mid-${s.midNumber}`);
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { courseKey?: unknown; courseName?: unknown; regulation?: unknown; components?: unknown; subjectFormats?: unknown };
    const courseKey = typeof body.courseKey === "string" ? body.courseKey.trim() : "";
    const courseName = typeof body.courseName === "string" ? body.courseName.trim() : "";
    const regulation = (typeof body.regulation === "string" ? body.regulation.trim().toUpperCase() : "") || "ALL";
    if (!courseKey || !courseName) throw new MidMarksError("Select a course.");
    const main = cleanComponents(body.components);
    if ("error" in main) throw new MidMarksError(main.error);
    const db = getAdminDb();
    const c = session.collegeId;

    const subjectFormats: NonNullable<MidExamFormat["subjectFormats"]> = {};
    const list = Array.isArray(body.subjectFormats) ? body.subjectFormats : [];
    if (list.length > 50) throw new MidMarksError("At most 50 subjects with their own components.");
    for (const r0 of list) {
      const r = (r0 ?? {}) as { subjectCode?: unknown; components?: unknown };
      const code = typeof r.subjectCode === "string" ? r.subjectCode.trim().toUpperCase() : "";
      if (!code) throw new MidMarksError("Enter the subject code of each subject with its own components.");
      // Master subjects keep their code in `code` (SubjectMasterService); `subjectCode` is read too for older docs.
      const subjectsCol = db.collection("colleges").doc(c).collection("subjects");
      const [byCode, byOld] = await Promise.all([subjectsCol.where("code", "==", code).get(), subjectsCol.where("subjectCode", "==", code).get()]);
      const subject = [...byCode.docs, ...byOld.docs].map((d) => ({ ...(d.data() as Subject), id: d.id }))
        .find((s) => regulation === "ALL" || String(s.regulation ?? "").trim().toUpperCase() === regulation) ?? null;
      if (!subject) throw new MidMarksError(`Subject ${code} not found${regulation === "ALL" ? "" : ` in ${regulation}`}.`);
      const comps = cleanComponents(r.components);
      if ("error" in comps) throw new MidMarksError(`${code}: ${comps.error}`);
      subjectFormats[subject.id] = { subjectCode: code, subjectName: subject.name ?? "", components: comps.components };
    }

    const byName = ((await db.collection("colleges").doc(c).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? session.email;
    const id = formatDocId(courseKey, regulation);
    const next: MidExamFormat = { id, courseKey, courseName, regulation, components: main.components, subjectFormats, updatedAt: new Date().toISOString(), updatedByName: byName };
    const blocked = await reshapedSheets(db, c, courseKey, regulation, next);
    if (blocked.length) {
      throw new MidMarksError(`Marks are already entered with the current components in ${blocked.length} sheet(s) (${blocked.slice(0, 3).join(", ")}${blocked.length > 3 ? " ..." : ""}). Keep those components.`, 409);
    }
    await formatsCol(db, c).doc(id).set(next);
    await writeAuditLogSafe(db, c, {
      action: "MID_EXAM_FORMAT_SET", performedBy: session.uid, performedByName: byName, targetId: id,
      details: { courseName, regulation, format: formatLine(main.components), subjects: Object.values(subjectFormats).map((s) => `${s.subjectCode}: ${formatLine(s.components)}`) },
    });
    return NextResponse.json({ format: next });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-exam-formats PUT]");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const db = getAdminDb();
    const c = session.collegeId;
    const ref = formatsCol(db, c).doc(id);
    const cur = id ? ((await ref.get()).data() as MidExamFormat | undefined) : undefined;
    if (!cur) throw new MidMarksError("Mid exam format not found. It may have been deleted.", 404);
    const blocked = await reshapedSheets(db, c, cur.courseKey, cur.regulation, null);
    if (blocked.length) throw new MidMarksError(`Marks are already entered with this format in ${blocked.length} sheet(s). It can't be deleted.`, 409);
    await ref.delete();
    const byName = ((await db.collection("colleges").doc(c).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? session.email;
    await writeAuditLogSafe(db, c, { action: "MID_EXAM_FORMAT_DELETED", performedBy: session.uid, performedByName: byName, targetId: id, details: { courseName: cur.courseName, regulation: cur.regulation } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-exam-formats DELETE]");
  }
}
