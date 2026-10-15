import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { getInChunks } from "@/lib/firestore/inQuery";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { SubjectCatalogValidator, type SubjectRowInput } from "../validation/SubjectValidator";
import { customCategoriesFrom, resolveImportCategory } from "../importCategory";
import { claimSubjectKeys, keyDocId, type SubjectKeyClaim, type SubjectKeyConflict } from "../subjectKeys";
import { normalizeSubjectCode, normalizeSubjectName, normalizeUniversityCode } from "../subjectIdentity";
import { planTeachingHoursSync, type HoursTarget } from "../hoursCascade";
import { MASTER_IMPORT_MAX_ROWS } from "../limits";
import type { Subject, SubjectSemesterAssignment } from "@/types";

// The one place a master subject is created, edited or removed. A master
// subject belongs to a Course Catalog course + Regulation and nothing else - no
// department, year or semester (those are an instance, made by assign-by-code).
//
// Identity, inside one catalog course + regulation:
//   - Subject Code is unique, Subject Name is unique, University Code is unique.
//   - Code and Name cannot change once the subject is assigned anywhere: a
//     renamed subject gets a new code, which makes it a NEW subject.
// Uniqueness is enforced twice: against the subjects already saved (so it holds
// for data that predates the lock docs) and by lock docs claimed in the same
// transaction as the write (so two concurrent saves cannot both win).

export { MASTER_IMPORT_MAX_ROWS };

export type SubjectActor = { uid: string; name?: string };

/** A request that cannot be served as asked; the route maps `status` straight to the response. */
export class SubjectRequestError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 422 = 400) {
    super(message);
  }
}

export interface MasterImportFailure {
  row: number;
  code: string;
  error: string;
  /** Set when `error` is specifically "this category isn't defined" - lets the dialog offer to add it. */
  kind?: "unknown-category" | "duplicate";
  value?: string;
  suggestion?: string;
}

export interface MasterImportResult {
  /** Rows saved (commit) or rows that would be saved (dry run). 0 whenever anything failed. */
  created: number;
  failed: MasterImportFailure[];
  warnings: { row: number; code: string; warning: string }[];
  createdRows: { row: number; subjectId: string; code: string }[];
}

export interface CourseScope {
  course: { id: string; name: string; catalogId?: string; departmentId?: string };
  /** catalogId when the course has one (sibling departments' Course docs share it), else the courseId. */
  scopeId: string;
  groupCourseIds: string[];
  regulations: string[];
}

type SubjectDoc = Subject & { id: string };

const COLLEGE = "colleges";

export class SubjectMasterService {
  constructor(private db: Firestore = getAdminDb()) {}

  private college(collegeId: string) {
    return this.db.collection(COLLEGE).doc(collegeId);
  }

  // ── scope ───────────────────────────────────────────────────────────────
  async loadScope(collegeId: string, courseId: string, regulation: string): Promise<CourseScope> {
    const college = this.college(collegeId);
    const courseSnap = await college.collection("courses").doc(courseId).get();
    if (!courseSnap.exists) throw new SubjectRequestError("Course not found.", 404);
    const course = courseSnap.data() as { name: string; catalogId?: string; departmentId?: string; isActive?: boolean };
    if (course.isActive === false) throw new SubjectRequestError("This course is inactive.");

    let regulations: string[] = [];
    let groupCourseIds = [courseId];
    if (course.catalogId) {
      const [catalogSnap, groupSnap] = await Promise.all([
        college.collection("courseCatalog").doc(course.catalogId).get(),
        college.collection("courses").where("catalogId", "==", course.catalogId).get(),
      ]);
      regulations = (catalogSnap.data() as { regulations?: string[] } | undefined)?.regulations ?? [];
      groupCourseIds = Array.from(new Set([courseId, ...groupSnap.docs.map((d) => d.id)]));
    }
    if (regulations.length === 0) throw new SubjectRequestError(`${course.name} has no regulations configured in the Course Catalog.`);
    if (!regulation?.trim()) throw new SubjectRequestError("Select a regulation first.");
    if (!regulations.includes(regulation.trim())) {
      throw new SubjectRequestError(`Regulation ${regulation} isn't assigned to ${course.name} (available: ${regulations.join(", ")}).`);
    }
    return { course: { id: courseId, name: course.name, catalogId: course.catalogId, departmentId: course.departmentId }, scopeId: course.catalogId || courseId, groupCourseIds, regulations };
  }

  /** Every subject saved for this catalog course + regulation, whichever department's Course doc it was filed under. */
  private async loadExisting(collegeId: string, scope: CourseScope, regulation: string): Promise<SubjectDoc[]> {
    const docs = await getInChunks(scope.groupCourseIds, (chunk) => this.college(collegeId).collection("subjects").where("courseId", "in", chunk));
    return docs
      .map((d) => ({ ...(d.data() as Subject), id: d.id }))
      .filter((s) => (s.regulation ?? "").trim() === regulation.trim());
  }

  // ── create / bulk import ────────────────────────────────────────────────
  /**
   * Validates `records` and, unless `dryRun`, saves them all in ONE transaction. Any problem
   * with any row means nothing is saved; the result lists every row that has one.
   */
  async importMany(p: {
    collegeId: string;
    courseId: string;
    regulation: string;
    records: SubjectRowInput[];
    dryRun?: boolean;
    actor?: SubjectActor;
  }): Promise<MasterImportResult> {
    const { collegeId, courseId, records } = p;
    const regulation = p.regulation.trim();
    if (records.length === 0) throw new SubjectRequestError("No records provided.");
    if (records.length > MASTER_IMPORT_MAX_ROWS) {
      throw new SubjectRequestError(`Maximum ${MASTER_IMPORT_MAX_ROWS} subjects per import. Split the file (for example by year).`);
    }
    const scope = await this.loadScope(collegeId, courseId, regulation);
    const [existing, categoriesSnap] = await Promise.all([
      this.loadExisting(collegeId, scope, regulation),
      this.college(collegeId).collection("subjectCategories").get(),
    ]);
    const customCategories = customCategoriesFrom(categoriesSnap.docs.map((d) => d.data()));

    const codes = new Map(existing.map((s) => [normalizeSubjectCode(s.code), s]));
    const names = new Map(existing.map((s) => [normalizeSubjectName(s.name), s]));
    const univ = new Map(existing.filter((s) => s.universityCode).map((s) => [normalizeUniversityCode(s.universityCode), s]));
    const fileCodes = new Map<string, number>();
    const fileNames = new Map<string, number>();
    const fileUniv = new Map<string, number>();

    const failed: MasterImportFailure[] = [];
    const warnings: MasterImportResult["warnings"] = [];
    const ready: { row: number; ref: DocumentReference; doc: Omit<Subject, "id"> }[] = [];
    const now = new Date();
    const subjects = this.college(collegeId).collection("subjects");

    records.forEach((raw, i) => {
      const row = i + 2; // spreadsheet row: header is row 1
      const codeLabel = raw.code?.toString().trim().toUpperCase() || "-";
      const fail = (error: string, extra: Partial<MasterImportFailure> = {}) => failed.push({ row, code: codeLabel, error, ...extra });

      if (raw.regulation?.toString().trim() && raw.regulation.toString().trim() !== regulation) {
        return fail(`Row is for regulation "${raw.regulation}" but ${regulation} is selected.`);
      }
      const v = SubjectCatalogValidator.validateRow({ ...raw, regulation }, { regulation });
      for (const w of v.warnings) warnings.push({ row, code: codeLabel, warning: w });
      if (!v.isValid || !v.data) return fail(v.errors.join("; "));
      const d = v.data;

      const categoryRaw = raw.category?.toString().trim() ?? "";
      const resolved = resolveImportCategory(categoryRaw, customCategories);
      if (resolved.kind === "unknown") {
        return fail(`Category "${categoryRaw}" isn't defined.${resolved.suggestion ? ` Did you mean ${resolved.suggestion}?` : ""} Add it under Academics > Categories.`, {
          kind: "unknown-category", value: categoryRaw, suggestion: resolved.suggestion,
        });
      }
      d.category = resolved.category;

      const nameKey = normalizeSubjectName(d.name);
      const problems: string[] = [];
      const codeOwner = codes.get(d.code);
      if (codeOwner) problems.push(`Code ${d.code} is already used by "${codeOwner.name}" for ${regulation}.`);
      const nameOwner = names.get(nameKey);
      if (nameOwner) problems.push(`The name "${d.name}" is already used by code ${nameOwner.code} for ${regulation}.`);
      const univKey = d.universityCode ? normalizeUniversityCode(d.universityCode) : "";
      const univOwner = univKey ? univ.get(univKey) : undefined;
      if (univOwner) problems.push(`University Code ${d.universityCode} is already used by ${univOwner.code} (${univOwner.name}).`);
      const rowOfCode = fileCodes.get(d.code);
      if (rowOfCode != null) problems.push(`Code ${d.code} is repeated (also on row ${rowOfCode}).`);
      const rowOfName = fileNames.get(nameKey);
      if (rowOfName != null) problems.push(`The name "${d.name}" is repeated (also on row ${rowOfName}).`);
      const rowOfUniv = univKey ? fileUniv.get(univKey) : undefined;
      if (rowOfUniv != null) problems.push(`University Code ${d.universityCode} is repeated (also on row ${rowOfUniv}).`);
      fileCodes.set(d.code, fileCodes.get(d.code) ?? row);
      fileNames.set(nameKey, fileNames.get(nameKey) ?? row);
      if (univKey) fileUniv.set(univKey, fileUniv.get(univKey) ?? row);
      if (problems.length > 0) return fail(problems.join(" "), { kind: "duplicate" });

      ready.push({
        row,
        ref: subjects.doc(),
        doc: {
          collegeId,
          ...(scope.course.catalogId ? { catalogId: scope.course.catalogId } : {}),
          courseId,
          courseName: scope.course.name,
          regulation,
          category: d.category,
          ...(d.customCategory ? { customCategory: d.customCategory } : {}),
          name: d.name,
          nameKey,
          code: d.code,
          ...(d.shortCode ? { shortCode: d.shortCode } : {}),
          ...(d.universityCode ? { universityCode: d.universityCode } : {}),
          hoursPerWeek: d.hoursPerWeek,
          ...(d.totalHoursPerSemester != null ? { totalHoursPerSemester: d.totalHoursPerSemester } : {}),
          lectureHours: d.lectureHours,
          tutorialHours: d.tutorialHours,
          practicalHours: d.practicalHours,
          credits: d.credits,
          type: d.type,
          ...(d.internalMarks != null ? { internalMarks: d.internalMarks } : {}),
          ...(d.externalMarks != null ? { externalMarks: d.externalMarks } : {}),
          ...(d.totalMarks != null ? { totalMarks: d.totalMarks } : {}),
          ...(raw.excludeFromTeachingLoad === true ? { isNonTeachingLoad: true, excludeFromResume: true } : {}),
          isActive: true,
          createdAt: now as unknown as Subject["createdAt"],
          updatedAt: now as unknown as Subject["updatedAt"],
        },
      });
    });

    const plannedRows = ready.map((r) => ({ row: r.row, subjectId: r.ref.id, code: r.doc.code }));
    if (failed.length > 0) return { created: 0, failed, warnings, createdRows: [] };
    if (p.dryRun) return { created: ready.length, failed, warnings, createdRows: plannedRows };

    // Chunked so a file near MASTER_IMPORT_MAX_ROWS never asks one Firestore
    // transaction for more than its ~500-write ceiling (3 writes/subject: the
    // doc + its code lock + its name lock, so 150 rows = 450 writes/chunk).
    // Each chunk independently claims its own locks and commits atomically;
    // a conflict in chunk N>1 means chunks before it already landed - the
    // message says so, since "nothing was imported" would be false then.
    const CHUNK_SIZE = 150;
    const createdRows: MasterImportResult["createdRows"] = [];
    for (let i = 0; i < ready.length; i += CHUNK_SIZE) {
      const chunk = ready.slice(i, i + CHUNK_SIZE);
      const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
      const claims: SubjectKeyClaim[] = chunk.flatMap((r) => [
        { field: "code" as const, scope: scope.scopeId, regulation, value: r.doc.code, subjectId: r.ref.id },
        { field: "name" as const, scope: scope.scopeId, regulation, value: r.doc.name, subjectId: r.ref.id },
      ]);
      let conflicts: SubjectKeyConflict[] = [];
      await this.db.runTransaction(async (tx) => {
        conflicts = await claimSubjectKeys(tx, this.db, collegeId, claims);
        if (conflicts.length > 0) return;
        for (const r of chunk) tx.set(r.ref, r.doc);
      });
      if (conflicts.length > 0) {
        const rowOf = new Map(chunk.flatMap((r) => [[`code:${r.ref.id}`, r.row], [`name:${r.ref.id}`, r.row]] as const));
        const partial = chunkNumber > 1
          ? ` Rows already saved (the first ${createdRows.length} of ${ready.length}) stay saved - only the rest need re-importing.`
          : " Nothing was imported.";
        return {
          created: createdRows.length,
          warnings,
          createdRows,
          failed: conflicts.map((c) => ({
            row: rowOf.get(`${c.claim.field}:${c.claim.subjectId}`) ?? 0,
            code: c.claim.field === "code" ? normalizeSubjectCode(c.claim.value) : "-",
            error: `${c.claim.field === "code" ? `Code ${normalizeSubjectCode(c.claim.value)}` : `The name "${c.claim.value}"`} was just saved by someone else as ${c.ownerCode} (${c.ownerName}).${partial}`,
          })),
        };
      }
      for (const r of chunk) createdRows.push({ row: r.row, subjectId: r.ref.id, code: r.doc.code });
    }

    await writeAuditLogSafe(this.db, collegeId, {
      action: createdRows.length === 1 ? "SUBJECT_CREATED" : "SUBJECTS_IMPORTED",
      performedBy: p.actor?.uid ?? "unknown",
      performedByName: p.actor?.name,
      targetId: createdRows.length === 1 ? createdRows[0].subjectId : courseId,
      details: { courseId, courseName: scope.course.name, regulation, count: createdRows.length, codes: createdRows.slice(0, 50).map((r) => r.code) },
    });
    return { created: createdRows.length, failed, warnings, createdRows };
  }

  // ── edit ────────────────────────────────────────────────────────────────
  async update(p: { collegeId: string; id: string; patch: Record<string, unknown>; actor?: SubjectActor }): Promise<{ cascaded: { instances: number; teachingAssignments: number; customizedLeftAlone: number } }> {
    const { collegeId, id, patch } = p;
    const college = this.college(collegeId);
    const ref = college.collection("subjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new SubjectRequestError("Subject not found.", 404);
    const cur = { ...(snap.data() as Subject), id };
    const isMaster = !!cur.courseId;

    const has = (k: string) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;
    const pick = <T,>(k: string, fallback: T): unknown => (has(k) ? patch[k] : fallback);
    const loadFlag = has("excludeFromTeachingLoad") ? patch.excludeFromTeachingLoad === true : null;

    // Validate the subject as it WOULD be after the edit - the same rulebook as create.
    const merged: SubjectRowInput = {
      name: pick("name", cur.name) as string,
      code: pick("code", cur.code) as string,
      shortCode: pick("shortCode", cur.shortCode ?? "") as string,
      universityCode: pick("universityCode", cur.universityCode ?? "") as string,
      category: pick("category", cur.category ?? "") as string,
      customCategory: pick("customCategory", cur.customCategory ?? "") as string,
      type: pick("type", cur.type) as string,
      lectureHours: pick("lectureHours", cur.lectureHours ?? 0) as number,
      tutorialHours: pick("tutorialHours", cur.tutorialHours ?? 0) as number,
      practicalHours: pick("practicalHours", cur.practicalHours ?? 0) as number,
      totalHoursPerSemester: pick("totalHoursPerSemester", cur.totalHoursPerSemester ?? "") as number,
      credits: pick("credits", cur.credits) as number,
      internalMarks: pick("internalMarks", cur.internalMarks ?? "") as number,
      externalMarks: pick("externalMarks", cur.externalMarks ?? "") as number,
      totalMarks: pick("totalMarks", cur.totalMarks ?? "") as number,
    };
    // A legacy, pre-restructuring subject has no L/T/P of its own; keep editing it by its weekly hours.
    if (!isMaster && cur.lectureHours == null && !has("lectureHours")) {
      merged.lectureHours = cur.hoursPerWeek ?? 0; merged.tutorialHours = 0; merged.practicalHours = 0;
    }
    const v = SubjectCatalogValidator.validateRow(merged);
    if (!v.isValid || !v.data) throw new SubjectRequestError(v.errors.join("; "));
    const d = v.data;

    if (has("category")) {
      const categoriesSnap = await college.collection("subjectCategories").get();
      const resolved = resolveImportCategory(String(patch.category).trim(), customCategoriesFrom(categoriesSnap.docs.map((x) => x.data())));
      if (resolved.kind === "unknown") throw new SubjectRequestError(`Category "${patch.category}" isn't defined. Add it under Academics > Categories.`);
      d.category = resolved.category;
    }

    const codeChanged = normalizeSubjectCode(d.code) !== normalizeSubjectCode(cur.code);
    const nameChanged = normalizeSubjectName(d.name) !== normalizeSubjectName(cur.name);
    const univChanged = normalizeUniversityCode(d.universityCode) !== normalizeUniversityCode(cur.universityCode);
    const identityChanged = codeChanged || nameChanged;
    const regulation = (cur.regulation ?? "").trim();

    // Instances of this subject (every department's semester copy).
    const [instancesSnap, taProbe] = await Promise.all([
      college.collection("subjectSemesterAssignments").where("subjectId", "==", id).get(),
      college.collection("teachingAssignments").where("subjectId", "==", id).limit(1).get(),
    ]);
    const inUse = !instancesSnap.empty || !taProbe.empty;

    if (identityChanged && inUse) {
      throw new SubjectRequestError(
        "This subject is already assigned to a semester, so its Code and Name can't change - results and timetables are tied to them. Create a new subject with the new code and assign that instead.",
        409,
      );
    }
    if (has("isActive") && patch.isActive === false && cur.isActive !== false && !instancesSnap.empty) {
      throw new SubjectRequestError("This subject is still assigned to a semester. Unassign it everywhere first, then deactivate it.", 409);
    }

    // Uniqueness against what is already saved (the lock docs below close the race).
    let scopeId = cur.catalogId || cur.courseId || "";
    if (isMaster && (identityChanged || univChanged)) {
      const scope = await this.loadScopeForExisting(collegeId, cur);
      scopeId = scope.scopeId;
      const others = (await this.loadExisting(collegeId, scope, regulation)).filter((s) => s.id !== id);
      if (codeChanged) {
        const hit = others.find((s) => normalizeSubjectCode(s.code) === d.code);
        if (hit) throw new SubjectRequestError(`Code ${d.code} is already used by "${hit.name}" for ${regulation}.`, 409);
      }
      if (nameChanged) {
        const hit = others.find((s) => normalizeSubjectName(s.name) === normalizeSubjectName(d.name));
        if (hit) throw new SubjectRequestError(`The name "${d.name}" is already used by code ${hit.code} for ${regulation}.`, 409);
      }
      if (univChanged && d.universityCode) {
        const hit = others.find((s) => normalizeUniversityCode(s.universityCode) === normalizeUniversityCode(d.universityCode));
        if (hit) throw new SubjectRequestError(`University Code ${d.universityCode} is already used by ${hit.code} (${hit.name}).`, 409);
      }
    }

    const now = new Date();
    const updates: Record<string, unknown> = {
      name: d.name, nameKey: normalizeSubjectName(d.name), code: d.code,
      shortCode: d.shortCode ?? FieldValue.delete(),
      universityCode: d.universityCode ?? FieldValue.delete(),
      category: d.category,
      customCategory: d.customCategory ?? FieldValue.delete(),
      type: d.type,
      lectureHours: d.lectureHours, tutorialHours: d.tutorialHours, practicalHours: d.practicalHours,
      hoursPerWeek: d.hoursPerWeek,
      totalHoursPerSemester: d.totalHoursPerSemester,
      credits: d.credits,
      ...(d.internalMarks != null ? { internalMarks: d.internalMarks } : { internalMarks: FieldValue.delete() }),
      ...(d.externalMarks != null ? { externalMarks: d.externalMarks } : { externalMarks: FieldValue.delete() }),
      ...(d.totalMarks != null ? { totalMarks: d.totalMarks } : { totalMarks: FieldValue.delete() }),
      updatedAt: now,
    };
    if (has("altShortCode")) {
      const alt = String(patch.altShortCode ?? "").trim().toUpperCase();
      updates.altShortCode = alt || FieldValue.delete();
    }
    if (has("isActive")) updates.isActive = patch.isActive === true;
    if (loadFlag != null) {
      Object.assign(updates, loadFlag ? { isNonTeachingLoad: true, excludeFromResume: true } : { isNonTeachingLoad: FieldValue.delete(), excludeFromResume: FieldValue.delete() });
    }

    // What the semester copies (and the teaching assignments hanging off them) must follow.
    const hoursChanged = d.hoursPerWeek !== (cur.hoursPerWeek ?? 0)
      || d.lectureHours !== (cur.lectureHours ?? 0) || d.tutorialHours !== (cur.tutorialHours ?? 0) || d.practicalHours !== (cur.practicalHours ?? 0);
    const creditsChanged = d.credits !== cur.credits;
    const mirror: Record<string, unknown> = {
      shortCode: updates.shortCode, universityCode: updates.universityCode, category: updates.category,
      customCategory: updates.customCategory, type: updates.type, totalHoursPerSemester: updates.totalHoursPerSemester,
      ...(has("altShortCode") ? { altShortCode: updates.altShortCode } : {}),
      ...(loadFlag != null ? { isNonTeachingLoad: updates.isNonTeachingLoad, excludeFromResume: updates.excludeFromResume } : {}),
    };

    const instances = instancesSnap.docs.map((x) => ({ ref: x.ref, ...(x.data() as SubjectSemesterAssignment) }));
    const followHours = instances.filter((i) => !i.isCustomized);
    const customizedLeftAlone = instances.length - followHours.length;
    let sync: { ref: DocumentReference; hoursPerWeek: number }[] = [];
    if (hoursChanged && followHours.length > 0) {
      const targets: HoursTarget[] = followHours
        .filter((i) => !!i.departmentId)
        .map((i) => ({ departmentId: i.departmentId!, semester: i.semester, year: i.year, hoursPerWeek: d.hoursPerWeek, hoursChanged: true }));
      const plan = await planTeachingHoursSync(this.db, collegeId, id, targets);
      if (plan.error) throw new SubjectRequestError(plan.error, 409);
      sync = plan.sync;
    }

    // The master (with its locks, when its identity moved) commits first; copies follow.
    if (isMaster && identityChanged) {
      const claims: SubjectKeyClaim[] = [];
      if (codeChanged) claims.push({ field: "code", scope: scopeId, regulation, value: d.code, subjectId: id });
      if (nameChanged) claims.push({ field: "name", scope: scopeId, regulation, value: d.name, subjectId: id });
      let conflicts: SubjectKeyConflict[] = [];
      await this.db.runTransaction(async (tx) => {
        conflicts = await claimSubjectKeys(tx, this.db, collegeId, claims);
        if (conflicts.length > 0) return;
        tx.update(ref, updates);
        if (codeChanged) tx.delete(college.collection("subjectKeys").doc(keyDocId({ field: "code", scope: scopeId, regulation, value: cur.code })));
        if (nameChanged) tx.delete(college.collection("subjectKeys").doc(keyDocId({ field: "name", scope: scopeId, regulation, value: cur.name })));
      });
      if (conflicts.length > 0) {
        const c = conflicts[0];
        throw new SubjectRequestError(`${c.claim.field === "code" ? "That code" : "That name"} was just taken by ${c.ownerCode} (${c.ownerName}).`, 409);
      }
    } else {
      await ref.update(updates);
    }

    const batch = new ChunkedBatch(this.db);
    for (const i of instances) {
      const patchInst: Record<string, unknown> = { ...mirror, updatedAt: now };
      if (!i.isCustomized && (hoursChanged || creditsChanged)) {
        Object.assign(patchInst, {
          lectureHours: d.lectureHours, tutorialHours: d.tutorialHours, practicalHours: d.practicalHours,
          hoursPerWeek: d.hoursPerWeek, credits: d.credits,
        });
      }
      batch.update(i.ref, patchInst);
    }
    for (const s of sync) batch.update(s.ref, { hoursPerWeek: s.hoursPerWeek, updatedAt: now });
    if (loadFlag != null && !taProbe.empty) {
      const tas = await college.collection("teachingAssignments").where("subjectId", "==", id).get();
      const flagPatch = loadFlag ? { isNonTeachingLoad: true, excludeFromResume: true } : { isNonTeachingLoad: FieldValue.delete(), excludeFromResume: FieldValue.delete() };
      for (const t of tas.docs) batch.update(t.ref, { ...flagPatch, updatedAt: now });
    }
    await batch.commit();

    await writeAuditLogSafe(this.db, collegeId, {
      action: "SUBJECT_UPDATED",
      performedBy: p.actor?.uid ?? "unknown",
      performedByName: p.actor?.name,
      targetId: id,
      details: { code: cur.code, name: cur.name, regulation, changed: Object.keys(patch) },
    });
    return { cascaded: { instances: instances.length, teachingAssignments: sync.length, customizedLeftAlone } };
  }

  private async loadScopeForExisting(collegeId: string, s: SubjectDoc): Promise<CourseScope> {
    return this.loadScope(collegeId, s.courseId!, s.regulation ?? "");
  }

  // ── delete ──────────────────────────────────────────────────────────────
  /** Deletes a subject nothing refers to. Anything in use must be unassigned first (or the subject deactivated). */
  async remove(p: { collegeId: string; id: string; actor?: SubjectActor }): Promise<void> {
    const { collegeId, id } = p;
    const college = this.college(collegeId);
    const ref = college.collection("subjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new SubjectRequestError("Subject not found.", 404);
    const s = snap.data() as Subject;

    const probes = await Promise.all(
      (["subjectSemesterAssignments", "teachingAssignments", "timetableSlots"] as const).map((c) =>
        college.collection(c).where("subjectId", "==", id).limit(1).get().then((r) => !r.empty),
      ),
    );
    const [assigned, taught, scheduled] = probes;
    if (assigned) throw new SubjectRequestError("This subject is still assigned to a department's semester. Unassign it everywhere first.", 409);
    if (taught) throw new SubjectRequestError("This subject still has teaching assignments. Remove or reassign them first.", 409);
    if (scheduled) throw new SubjectRequestError("This subject still has timetable periods. Remove them first.", 409);

    const batch = this.db.batch();
    batch.delete(ref);
    if (s.courseId) {
      const scopeId = s.catalogId || (await this.safeScopeId(collegeId, s.courseId));
      const regulation = (s.regulation ?? "").trim();
      batch.delete(college.collection("subjectKeys").doc(keyDocId({ field: "code", scope: scopeId, regulation, value: s.code })));
      batch.delete(college.collection("subjectKeys").doc(keyDocId({ field: "name", scope: scopeId, regulation, value: s.name })));
    }
    await batch.commit();
    await writeAuditLogSafe(this.db, collegeId, {
      action: "SUBJECT_DELETED",
      performedBy: p.actor?.uid ?? "unknown",
      performedByName: p.actor?.name,
      targetId: id,
      details: { code: s.code, name: s.name, regulation: s.regulation },
    });
  }

  private async safeScopeId(collegeId: string, courseId: string): Promise<string> {
    const c = await this.college(collegeId).collection("courses").doc(courseId).get();
    return (c.data() as { catalogId?: string } | undefined)?.catalogId || courseId;
  }
}
