export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { courseIdsForKey, teachingFor } from "@/lib/midBank/server";
import { loadPlan } from "@/lib/midTimetable/server";
import { contextFor, midMarksSheetId, midMarksSheetsCol, rosterOf, type Ctx } from "@/lib/midMarks/server";
import { formatCache } from "@/lib/midMarks/formatServer";
import { writeFormatSheet } from "@/lib/midMarks/formatSheets";
import { parseWorkbook, planFile, type RawWorkbook } from "@/lib/midMarks/fileUpload";
import { coPendingCount } from "@/lib/midMarks/format";
import { MidMarksError } from "@/lib/midMarks/sheet";
import { midMarksErrorResponse } from "@/lib/midMarks/http";
import type { MidMarksSheet } from "@/types/midMarks";
import type { TeachingAssignment } from "@/types";

// Exam Cell > Mid Marks > Upload Mid Files (Mid exam format colleges). The page reads each workbook (one per subject
// per section, a sheet per component) and sends its cells, at most 10 files a call:
// POST { planId, apply: boolean, files: [{ fileName, sheets: [{ name, rows: [[cell ...]] }] }] }
// Each file: subject from its Subject Code (must be a subject of that Mid), section from its students' Regd. Nos,
// marks checked against the subject's Mid exam format (our totals must equal the file's Total columns).
// apply false = checked only, nothing written; apply true = each file without errors is saved (SUBMITTED, entered by
// the Exam Cell), a file with errors is skipped. Students see the marks once the Exam Cell freezes the sheet.

const MAX_FILES = 10;
const MAX_CELLS = 120_000;

interface FileResult {
  fileName: string; subjectCode: string; subjectName?: string; section?: string; department?: string; sheetId?: string;
  students: number; absent: number; notInFile: number; coPending: number;
  errors: string[]; notes: string[]; saved?: boolean;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { planId?: unknown; apply?: unknown; files?: unknown };
    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!planId) throw new MidMarksError("Select the Mid timetable.");
    const files = (Array.isArray(body.files) ? body.files : []) as RawWorkbook[];
    if (!files.length) throw new MidMarksError("Select the marks files.");
    if (files.length > MAX_FILES) throw new MidMarksError(`At most ${MAX_FILES} files at a time.`);
    const cells = files.reduce((n, f) => n + (Array.isArray(f?.sheets) ? f.sheets : []).reduce((m, s) => m + (Array.isArray(s?.rows) ? s.rows : []).reduce((k, r) => k + (Array.isArray(r) ? r.length : 0), 0), 0), 0);
    if (cells > MAX_CELLS) throw new MidMarksError("The files are too large for one upload. Upload fewer at a time.");
    const apply = body.apply === true;

    const db = getAdminDb();
    const c = session.collegeId;
    const plan = await loadPlan(db, c, planId);
    if (!plan) throw new MidMarksError("Mid timetable not found. It may have been deleted.", 404);
    const byName = ((await db.collection("colleges").doc(c).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? session.email;
    const { ids } = await courseIdsForKey(db, c, plan.courseKey);
    const rows = await teachingFor(db, c, { courseIds: ids, year: plan.year, semester: plan.semester });
    const subjectByCode = new Map(rows.map((r) => [r.subjectCode.trim().toUpperCase(), r]));
    const formatOf = formatCache(db, c);

    // Per subject: its current teaching assignments, one per section (the first); a section's roster is read only when
    // a file points to it (its students' section), so a call never reads every section of a big subject.
    const assignmentsCache = new Map<string, Promise<TeachingAssignment[]>>();
    const assignmentsOf = (subjectId: string) => {
      if (!assignmentsCache.has(subjectId)) assignmentsCache.set(subjectId, (async () => {
        const sectionIds = new Set(rows.filter((r) => r.subjectId === subjectId).map((r) => r.sectionId));
        const tas = (await db.collection("colleges").doc(c).collection("teachingAssignments").where("subjectId", "==", subjectId).get()).docs
          .map((d) => ({ ...(d.data() as TeachingAssignment), id: d.id }))
          .filter((a) => !a.isPast && a.sectionId && sectionIds.has(a.sectionId))
          .sort((a, b) => a.id.localeCompare(b.id));
        const seen = new Set<string>();
        return tas.filter((a) => (seen.has(a.sectionId!) ? false : (seen.add(a.sectionId!), true)));
      })());
      return assignmentsCache.get(subjectId)!;
    };
    const rosterCache = new Map<string, Promise<{ ctx: Ctx; rolls: Set<string> } | null>>();
    const sectionOf = (assignmentId: string) => {
      if (!rosterCache.has(assignmentId)) rosterCache.set(assignmentId, (async () => {
        const ctx = await contextFor(db, c, assignmentId).catch(() => null);
        if (!ctx) return null;
        return { ctx, rolls: new Set((await rosterOf(db, c, ctx)).map((s) => s.rollNumber.trim().toUpperCase()).filter(Boolean)) };
      })());
      return rosterCache.get(assignmentId)!;
    };
    /** The sections to look in for a file's students: the ones a sample of its Regd. Nos are filed under, else all. */
    const candidateSections = async (subjectId: string, rolls: string[]) => {
      const tas = await assignmentsOf(subjectId);
      const sample = rolls.slice(0, 10);
      const students = db.collection("colleges").doc(c).collection("students");
      type Hint = { department?: string; secondaryDepartment?: string; section?: string };
      let found: Hint[] = sample.length ? (await students.where("rollNumberUpper", "in", sample).get()).docs.map((d) => d.data() as Hint) : [];
      if (!found.length && sample.length) found = (await students.where("rollNumber", "in", sample).get()).docs.map((d) => d.data() as Hint);
      // The subject's sections (by the section's own department - the branch) those students are filed under.
      const sectionIds = new Set(rows.filter((r) => r.subjectId === subjectId && found.some((st) => st.section === r.sectionName && [st.department, st.secondaryDepartment].includes(r.realBranch ?? r.branch))).map((r) => r.sectionId));
      const hinted = tas.filter((a) => sectionIds.has(a.sectionId!));
      const pick = hinted.length ? hinted : tas;
      return (await Promise.all(pick.map((a) => sectionOf(a.id)))).filter((x): x is { ctx: Ctx; rolls: Set<string> } => !!x);
    };
    const allSections = async (subjectId: string) =>
      (await Promise.all((await assignmentsOf(subjectId)).map((a) => sectionOf(a.id)))).filter((x): x is { ctx: Ctx; rolls: Set<string> } => !!x);

    const results: FileResult[] = [];
    for (const f of files) {
      const fileName = String(f?.fileName ?? "").slice(0, 200) || "file";
      const r: FileResult = { fileName, subjectCode: "", students: 0, absent: 0, notInFile: 0, coPending: 0, errors: [], notes: [] };
      results.push(r);
      const parsed = parseWorkbook({ fileName, sheets: Array.isArray(f?.sheets) ? f.sheets : [] });
      if ("error" in parsed) { r.errors.push(parsed.error); continue; }
      r.subjectCode = parsed.subjectCode;
      const subj = subjectByCode.get(parsed.subjectCode);
      if (!subj) { r.errors.push(`${parsed.subjectCode || "The subject"} is not a subject of this Mid (${plan.courseName}, Year ${plan.year}, Semester ${plan.semester}).`); continue; }
      r.subjectName = subj.subjectName;
      const fmt = await formatOf(subj.subjectId);
      if (!fmt) { r.errors.push(`${subj.subjectCode} has no Mid exam format. Set it in Mid Configuration › Marks.`); continue; }
      const p = planFile(parsed, fmt.components);
      r.errors.push(...p.errors);
      r.notes.push(...p.notes);
      if (p.errors.length && !p.students.length) continue;

      // The section: the one most of the file's students are in.
      const fileRolls = p.students.map((s) => s.roll);
      const sections = await candidateSections(subj.subjectId, fileRolls);
      const scored = sections.map((s) => ({ s, n: fileRolls.filter((x) => s.rolls.has(x)).length })).sort((a, b) => b.n - a.n);
      const best = scored[0]?.n ? scored[0].s : null;
      if (!best) { r.errors.push("None of the file's students are in a section of this subject."); continue; }
      r.section = best.ctx.section.name;
      r.department = best.ctx.section.department;
      const elsewhere = fileRolls.filter((x) => !best.rolls.has(x));
      const everywhere = elsewhere.length ? await allSections(subj.subjectId) : [];
      for (const roll of elsewhere.slice(0, 10)) {
        const other = everywhere.find((s) => s.rolls.has(roll));
        r.errors.push(other ? `${roll} is in Section ${other.ctx.section.name}, not ${best.ctx.section.name}.` : `${roll} was not found in this subject's sections. Check the Regd. No, or ask the College Office to add the student.`);
      }
      if (elsewhere.length > 10) r.errors.push(`${elsewhere.length - 10} more students are not in Section ${best.ctx.section.name}.`);
      r.notInFile = [...best.rolls].filter((x) => !fileRolls.includes(x)).length;
      if (r.notInFile) r.notes.push(`${r.notInFile} student${r.notInFile === 1 ? "" : "s"} of Section ${best.ctx.section.name} ${r.notInFile === 1 ? "is" : "are"} not in the file.`);
      r.students = p.students.length;
      r.absent = p.students.filter((s) => s.absent).length;
      r.coPending = coPendingCount({ components: fmt.components, questions: p.questions });
      r.sheetId = midMarksSheetId(best.ctx.a.id, plan.midNumber);
      const cur = (await midMarksSheetsCol(db, c).doc(r.sheetId).get()).data() as MidMarksSheet | undefined;
      if (cur?.status === "FROZEN") r.errors.push("Already frozen. Reopen the sheet before uploading again.");
      else if (cur && !cur.format) r.errors.push("This section's Mid marks are entered against the printed paper, not the Mid exam format.");
      else if (cur?.status === "SUBMITTED" && !cur.enteredBy) r.notes.push(`Submitted by ${cur.facultyName}; the upload replaces those marks.`);
      else if (cur?.enteredBy) r.notes.push("Uploaded before; this upload replaces those marks.");
      if (r.coPending && !r.errors.length) r.notes.push(`CO pending for ${r.coPending} question box${r.coPending === 1 ? "" : "es"} - set them on the sheet after saving.`);

      if (!apply || r.errors.length) continue;
      try {
        await writeFormatSheet(db, c, {
          assignmentId: best.ctx.a.id, mid: plan.midNumber, byName, components: fmt.components, questions: p.questions,
          upload: { students: p.students, fileName },
        });
        r.saved = true;
      } catch (e) {
        if (!(e instanceof MidMarksError)) throw e;
        r.errors.push(e.message);
      }
    }

    if (apply) {
      const saved = results.filter((x) => x.saved);
      await writeAuditLogSafe(db, c, {
        action: "MID_MARKS_FILE_UPLOADED", performedBy: session.uid, performedByName: byName, targetId: planId,
        details: { midNumber: plan.midNumber, saved: saved.map((x) => `${x.subjectCode} ${x.section}`), skipped: results.filter((x) => !x.saved).map((x) => x.fileName) },
      });
    }
    return NextResponse.json({ results });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets/upload POST]");
  }
}
