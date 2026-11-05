import { randomBytes } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { CertificateRequest, CertificateTypeConfig, College, IssuedCertificate, StudentRecord } from "@/types";
import { loadStudentByUid } from "@/lib/studentPermissions/service";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { loadResultRules } from "@/lib/examResults/store";
import { buildStudentResults, type StudentResultsView } from "@/lib/examResults/studentResults";
import { loadPublishedSittings } from "@/lib/examResults/studentSittings";
import { buildInitialStep, CERTIFICATE_REQUESTS_COL, CertificateStateConflictError, recipientContext } from "./transitions";
import { resolveRecipientUids } from "./configStore";
import { canDecide } from "./decisionRules";
import { buildCertificateValues, displayDate } from "./documentValues";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { resolveSectionCurrentSemester } from "@/lib/college/semester";
import { toRoman } from "@/lib/academic/format";
import { missingPlaceholders, renderCertificateHtml } from "./render";
import { issuedCol, issuedDocumentDoc, loadIssued, loadSettings, loadTemplate, loadType, loadTypes, countersCol, verificationsCol } from "./store";
import { cleanPurpose, cleanValues, eligibilityProblem, formatCertificateNumber } from "./typeConfig";
import { CertificationError } from "./types";
import type { ActingUser } from "./types";
import * as notifications from "./notifications";

// Requests of the certificate types a college configures (Principal / College Admin): the student's catalogue,
// applying, and issuing - the number, the frozen copy, the register entry and the public QR record are written
// together. Approvals go through the same transactional engine as the original No Due flow (transitions.ts).

const OPEN = ["IN_PROGRESS", "PENDING_ISSUANCE", "RETURNED"];
type StoredRequest = Omit<CertificateRequest, "id">;
const rowOf = (d: FirebaseFirestore.DocumentSnapshot): CertificateRequest => ({ id: d.id, ...(d.data() as StoredRequest) });

export interface CatalogEntry {
  type: Pick<CertificateTypeConfig, "id" | "name" | "code" | "category" | "description" | "purposes" | "allowOtherPurpose" | "fields" | "attachments" | "feeAmount" | "delivery" | "onceOnly">;
  steps: string[];
  /** Why the student can't apply now (not eligible, already issued once ...) - null = they can. */
  blocked: string | null;
  openRequestId: string | null;
}

/** The certificates a student may apply for, with why one is unavailable to them. */
export async function studentCatalog(db: Firestore, user: ActingUser): Promise<{ entries: CatalogEntry[]; linked: boolean }> {
  const student = await loadStudentByUid(db, user.collegeId, user.uid);
  if (!student) return { entries: [], linked: false };
  const [types, mine] = await Promise.all([
    loadTypes(db, user.collegeId),
    CERTIFICATE_REQUESTS_COL(db, user.collegeId).where("requesterUid", "==", user.uid).get(),
  ]);
  const requests = mine.docs.map(rowOf);
  const entries = types.filter((t) => t.isActive).map((t): CatalogEntry => {
    const ofType = requests.filter((r) => r.certificateTypeId === t.id);
    const open = ofType.find((r) => OPEN.includes(r.status));
    const issued = ofType.some((r) => r.status === "ISSUED");
    const blocked = t.startedBy === "OFFICE" ? "Started by the College Office for your class - it appears in My requests"
      : eligibilityProblem(t, student) ?? (t.onceOnly && issued ? "Already issued to you - it is issued only once" : null);
    return {
      type: {
        id: t.id, name: t.name, code: t.code, category: t.category, description: t.description, purposes: t.purposes, allowOtherPurpose: t.allowOtherPurpose,
        fields: t.fields, attachments: t.attachments, feeAmount: t.feeAmount, delivery: t.delivery, onceOnly: t.onceOnly,
      },
      steps: t.flow.map((s) => s.label),
      blocked, openRequestId: open?.id ?? null,
    };
  });
  return { entries, linked: true };
}

/** A student's documents must be ones they uploaded through upload/certificate-attachment (their own folder). */
export function cleanAttachments(t: Pick<CertificateTypeConfig, "attachments">, raw: unknown, collegeId: string, uid: string): CertificateRequest["attachments"] {
  const given = (Array.isArray(raw) ? raw : []) as { key?: string; url?: string }[];
  const prefix = encodeURIComponent(`certificate-attachments/${collegeId}/${uid}/`);
  const out: NonNullable<CertificateRequest["attachments"]> = [];
  for (const a of t.attachments) {
    const g = given.find((x) => x?.key === a.key && typeof x.url === "string" && x.url);
    if (!g) {
      if (a.required) throw new CertificationError("INVALID", `Attach "${a.label}"`, 400);
      continue;
    }
    if (!g.url!.startsWith("https://firebasestorage.googleapis.com/") || !g.url!.includes(`/o/${prefix}`)) {
      throw new CertificationError("INVALID", `Upload "${a.label}" again`, 400);
    }
    out.push({ key: a.key, label: a.label, url: g.url! });
  }
  return out;
}

export async function submitConfigured(db: Firestore, user: ActingUser, raw: unknown): Promise<{ alreadyExists: boolean; request: CertificateRequest }> {
  const body = (raw ?? {}) as { typeId?: unknown; purpose?: unknown; purposeOther?: unknown; values?: unknown; attachments?: unknown };
  const typeId = typeof body.typeId === "string" ? body.typeId : "";
  const type = typeId ? await loadType(db, user.collegeId, typeId) : null;
  if (!type || !type.isActive) throw new CertificationError("NOT_FOUND", "This certificate isn't available", 404);
  if (type.startedBy === "OFFICE") throw new CertificationError("INVALID", "The College Office starts this certificate for your class", 400);

  const student = await loadStudentByUid(db, user.collegeId, user.uid);
  if (!student) throw new CertificationError("INVALID", "Your login isn't linked to a student record yet. Please contact your College Office.", 400);
  const problem = eligibilityProblem(type, student);
  if (problem) throw new CertificationError("NOT_ELIGIBLE", problem, 400);

  const col = CERTIFICATE_REQUESTS_COL(db, user.collegeId);
  const existing = (await col.where("studentId", "==", student.id).where("certificateTypeId", "==", type.id).get()).docs.map(rowOf);
  const open = existing.find((r) => OPEN.includes(r.status));
  if (open) return { alreadyExists: true, request: open };
  if (type.onceOnly && existing.some((r) => r.status === "ISSUED")) throw new CertificationError("ALREADY_ISSUED", "This certificate is issued only once and you already have it", 409);

  const purpose = cleanPurpose(type, body.purpose, body.purposeOther);
  if (!purpose.ok) throw new CertificationError("INVALID", purpose.error, 400);
  const values = cleanValues(type.fields, body.values);
  if (!values.ok) throw new CertificationError("INVALID", values.error, 400);
  const attachments = cleanAttachments(type, body.attachments, user.collegeId, user.uid);

  const { steps, pendingRecipientUids } = await buildInitialStep(db, user.collegeId, type.flow, student.department, student.id);
  if (pendingRecipientUids.length === 0) {
    throw new CertificationError("NO_APPROVER", `No one is set to approve "${type.flow[0].label}" for you yet - please contact the College Office.`, 409);
  }
  const now = new Date();
  const data: StoredRequest = {
    collegeId: user.collegeId, certificateTypeKey: type.code, certificateTypeLabel: type.name,
    certificateTypeId: type.id, certificateTypeCode: type.code, issuer: type.issuer, templateId: type.templateId,
    issuerFields: type.issuerFields, feeAmount: type.feeAmount, fields: type.fields, values: values.value, attachments: attachments ?? [],
    requesterUid: user.uid, requesterName: user.name, ...(purpose.value ? { purpose: purpose.value } : {}),
    studentId: student.id, studentRollNumber: student.rollNumber, studentName: student.name,
    studentDepartment: student.department, studentYear: student.year, studentSection: student.section,
    status: "IN_PROGRESS", flow: type.flow, currentStepIndex: 0, steps, pendingRecipientUids,
    history: [{ action: "SUBMITTED", byUid: user.uid, byName: user.name, byRole: user.role, at: now }],
    createdAt: now, updatedAt: now,
  } as unknown as StoredRequest;
  const ref = await col.add(data);
  const request: CertificateRequest = { id: ref.id, ...data };

  await writeAuditLogSafe(db, user.collegeId, {
    action: "CERTIFICATE_REQUEST_SUBMITTED", performedBy: user.uid, performedByName: user.name, targetId: ref.id, details: { student: student.name, certificate: type.name },
  });
  await notifyStepRecipients(db, user.collegeId, request);
  return { alreadyExists: false, request };
}

/** Everyone who can act on the request's current step (or its issuance) is told - one popup per person. */
export async function notifyStepRecipients(db: Firestore, collegeId: string, req: CertificateRequest): Promise<void> {
  const who = `${req.studentName} (${req.studentRollNumber})`;
  if (req.status === "PENDING_ISSUANCE") {
    for (const uid of req.pendingRecipientUids) {
      await notifications.notifyIssuerOf(db, collegeId, req, uid, `${req.certificateTypeLabel} ready to issue`, `${who}'s ${req.certificateTypeLabel} is approved and ready to issue.`);
    }
    return;
  }
  const step = req.flow[req.currentStepIndex];
  if (!step) return;
  if (step.type === "PARALLEL") {
    const current = req.steps[req.currentStepIndex];
    const pending = current?.type === "PARALLEL" ? current.branches.filter((b) => b.status === "PENDING").map((b) => b.branchKey) : step.branches.map((b) => b.key);
    for (const branch of step.branches.filter((b) => pending.includes(b.key))) {
      const uids = await resolveRecipientUids(db, collegeId, branch.recipient, recipientContext(req));
      await notifications.notifyBranchRecipients(
        db, collegeId, req, branch.key, uids, `${req.certificateTypeLabel} - ${branch.label} approval needed`,
        `${who} has applied for a ${req.certificateTypeLabel}; your approval is needed.`, "/certificates",
      );
    }
    return;
  }
  await notifications.notifyNewStep(
    db, collegeId, req, `${req.certificateTypeLabel} - ${step.label.toLowerCase()} needed`,
    `${who} has applied for a ${req.certificateTypeLabel}.`, "/certificates", "certificateRequest",
  );
}

// ─── Building the certificate ─────────────────────────────────────────────────────

interface Built { html: string; missing: string[]; uploadOnly: boolean }

async function buildDocument(
  db: Firestore, collegeId: string, req: CertificateRequest,
  opts: { issuerValues: Record<string, string>; certificateNumber?: string; verificationCode?: string; baseUrl: string; preview: boolean; issueDate: Date },
): Promise<Built> {
  const [template, type, settings, collegeSnap, studentSnap, academicYear] = await Promise.all([
    loadTemplate(db, collegeId, req.templateId ?? ""),
    loadType(db, collegeId, req.certificateTypeId ?? ""),
    loadSettings(db, collegeId),
    db.collection("colleges").doc(collegeId).get(),
    db.collection("colleges").doc(collegeId).collection("students").doc(req.studentId).get(),
    resolveCollegeAcademicYear(db, collegeId),
  ]);
  if (!template) throw new CertificationError("NO_TEMPLATE", "This certificate's template was deleted - pick another one in Certificate Setup", 409);
  const college = (collegeSnap.data() ?? {}) as Partial<College>;
  const student = (studentSnap.data() ?? {}) as Partial<StudentRecord>;

  const texts = [template.body ?? "", template.footer ?? "", ...(template.rows ?? []).map((r) => r.value)];
  const needsResults = template.kind === "MARKS" || texts.some((t) => t.includes("{{cgpa"));
  let marks: StudentResultsView | null = null;
  if (needsResults) {
    const [{ rules }, sittings] = await Promise.all([loadResultRules(db, collegeId), loadPublishedSittings(db, collegeId, req.studentId)]);
    marks = buildStudentResults(sittings, rules);
  }
  const cgpa = marks && marks.cgpa != null && !marks.cgpaWithheld ? marks.cgpa.toFixed(marks.decimals ?? 2) : "";
  const values = buildCertificateValues({
    student, request: req, issuerValues: opts.issuerValues, academicYear, cgpa, certificateNumber: opts.certificateNumber, issueDate: opts.issueDate,
  });
  // The form's Semester: the student's current semester (from their section's course-year timings), when asked for.
  if (!values.semester && texts.some((t) => t.includes("{{semester"))) {
    const section = await findCurrentSectionDoc(db, collegeId, student as StudentRecord).catch(() => null);
    const courseId = (section?.data() as { courseId?: string } | undefined)?.courseId;
    const sem = courseId && student.year ? await resolveSectionCurrentSemester(db, collegeId, courseId, student.year).catch(() => null) : null;
    if (sem) values.semester = toRoman(sem);
  }
  const signature = settings.signatures.find((s) => s.id === type?.signatureId) ?? settings.signatures[0] ?? null;
  const html = renderCertificateHtml(template, {
    clearances: clearanceRows(req),
    college: { name: college.name ?? "", address: college.address, logoUrl: college.logoUrl },
    values, marks, signature, certificateNumber: opts.certificateNumber, preview: opts.preview,
    verifyUrl: opts.verificationCode ? `${opts.baseUrl}/verify-certificate/${opts.verificationCode}` : opts.preview ? `${opts.baseUrl}/verify-certificate/PREVIEW` : undefined,
  });
  const missing = missingPlaceholders(texts, { ...values, collegeName: college.name ?? "", certificateNumber: "x" });
  if (template.kind === "MARKS" && (!marks || marks.semesters.length === 0)) missing.push("published results");
  return { html, missing, uploadOnly: template.kind === "UPLOAD" };
}

/** One line per department of the request's parallel steps, as the certificate prints it. */
export function clearanceRows(req: Pick<CertificateRequest, "flow" | "steps">): { label: string; status: string; by: string; date: string }[] {
  const rows: { label: string; status: string; by: string; date: string }[] = [];
  req.flow.forEach((step, i) => {
    const st = req.steps[i];
    if (step.type !== "PARALLEL" || st?.type !== "PARALLEL") return;
    for (const b of step.branches) {
      const c = st.branches.find((x) => x.branchKey === b.key);
      const at = c?.decidedAt as unknown as { toDate?: () => Date } | Date | undefined;
      const date = at instanceof Date ? at : at?.toDate?.();
      const status = c?.status !== "ACCEPTED" ? (c?.status === "REJECTED" ? "Rejected" : "Pending")
        : b.check === "RESULT" ? (c.result?.outcome === "PASS" ? "Pass" : c.result?.outcome === "FAIL" ? "Fail" : "No results")
        : c.outcome === "NOT_APPLICABLE" ? "Not applicable" : c.outcome === "NO_DUES" ? "No dues" : "Approved";
      rows.push({ label: b.label, status, by: c?.decidedByName ?? "", date: date ? displayDate(date) : "" });
    }
  });
  return rows;
}

async function loadIssuable(db: Firestore, user: ActingUser, id: string): Promise<CertificateRequest> {
  const snap = await CERTIFICATE_REQUESTS_COL(db, user.collegeId).doc(id).get();
  if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
  const req = rowOf(snap);
  if (!req.certificateTypeId) throw new CertificationError("INVALID", "Issue this No Due request from the College Office's No Due page", 400);
  if (req.status !== "PENDING_ISSUANCE") throw new CertificateStateConflictError("This request isn't ready to issue.");
  if (!canDecide(user.uid, req.requesterUid, req.pendingRecipientUids)) throw new CertificationError("FORBIDDEN", "You can't issue this certificate", 403);
  return req;
}

function issuerEntries(req: CertificateRequest, raw: unknown, strict: boolean): Record<string, string> {
  const r = cleanValues(req.issuerFields ?? [], raw, true);
  if (r.ok) return r.value;
  if (strict) throw new CertificationError("INVALID", r.error, 400);
  // Preview: show what can be shown.
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries((req.issuerFields ?? []).map((f) => [f.key, typeof input[f.key] === "string" && input[f.key] ? String(input[f.key]) : f.defaultValue ?? ""]).filter(([, v]) => v));
}

export async function previewIssue(db: Firestore, user: ActingUser, id: string, raw: unknown, baseUrl: string): Promise<Built> {
  const req = await loadIssuable(db, user, id);
  const body = (raw ?? {}) as { issuerValues?: unknown };
  return buildDocument(db, user.collegeId, req, { issuerValues: issuerEntries(req, body.issuerValues, false), baseUrl, preview: true, issueDate: new Date() });
}

const newCode = () => randomBytes(8).toString("base64url").replace(/[-_]/g, "").toUpperCase().slice(0, 10).padEnd(10, "X");

function istYear(d: Date) { return new Date(d.getTime() + 330 * 60_000).getUTCFullYear(); }

/** The next number of a format, once per issue: kept on the request so a retry after a failure reuses it. */
async function reserveNumber(db: Firestore, collegeId: string, req: CertificateRequest, type: CertificateTypeConfig | null): Promise<{ number: string; code: string }> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(req.id);
  const academicYear = await resolveCollegeAcademicYear(db, collegeId);
  const year = istYear(new Date());
  const code = req.certificateTypeCode ?? type?.code ?? "CERT";
  const format = type?.numberFormat ?? "{CODE}/{YYYY}/{SEQ}";
  // One counter per printed prefix: two types sharing a format still never print the same number.
  const counterKey = formatCertificateNumber(format, { code, year, academicYear, seq: 0 }).replace(/0000/g, "").replace(/[^A-Za-z0-9-]/g, "_").slice(0, 120) || "default";
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = rowOf(snap);
    if (current.status !== "PENDING_ISSUANCE") throw new CertificateStateConflictError("This request isn't ready to issue.");
    if (current.reservedNumber && current.verificationCode) return { number: current.reservedNumber, code: current.verificationCode };
    const counterRef = countersCol(db, collegeId).doc(counterKey);
    const counter = await tx.get(counterRef);
    const seq = ((counter.data()?.next as number | undefined) ?? 1);
    const number = formatCertificateNumber(format, { code, year, academicYear, seq });
    const verificationCode = newCode();
    tx.set(counterRef, { next: seq + 1, format, updatedAt: new Date() }, { merge: true });
    tx.update(ref, { reservedNumber: number, verificationCode });
    return { number, code: verificationCode };
  });
}

/** Issues a certificate: the number, the frozen copy, the register entry and the public QR record in one go. */
export async function issueConfigured(db: Firestore, user: ActingUser, id: string, raw: unknown, baseUrl: string): Promise<CertificateRequest> {
  const req = await loadIssuable(db, user, id);
  const body = (raw ?? {}) as { issuerValues?: unknown; feeReceiptNo?: unknown; uploadedUrl?: unknown };
  const issuerValues = issuerEntries(req, body.issuerValues, true);
  const feeReceiptNo = typeof body.feeReceiptNo === "string" ? body.feeReceiptNo.trim().slice(0, 60) : "";
  if ((req.feeAmount ?? 0) > 0 && !feeReceiptNo) throw new CertificationError("INVALID", `Enter the receipt number of the Rs. ${req.feeAmount} fee`, 400);

  const type = await loadType(db, user.collegeId, req.certificateTypeId!);
  const template = await loadTemplate(db, user.collegeId, req.templateId ?? "");
  if (!template) throw new CertificationError("NO_TEMPLATE", "This certificate's template was deleted - pick another one in Certificate Setup", 409);
  let uploadedUrl = "";
  if (template.kind === "UPLOAD") {
    uploadedUrl = typeof body.uploadedUrl === "string" ? body.uploadedUrl : "";
    const prefix = encodeURIComponent(`certificate-uploads/${user.collegeId}/${req.id}/`);
    if (!uploadedUrl.startsWith("https://firebasestorage.googleapis.com/") || !uploadedUrl.includes(`/o/${prefix}`)) {
      throw new CertificationError("INVALID", "Upload the certificate PDF first", 400);
    }
  }

  const { number, code } = await reserveNumber(db, user.collegeId, req, type);
  const now = new Date();
  const withFee = { ...req, feeReceiptNo: feeReceiptNo || undefined };
  const built = await buildDocument(db, user.collegeId, withFee, { issuerValues, certificateNumber: number, verificationCode: code, baseUrl, preview: false, issueDate: now });

  const reqRef = CERTIFICATE_REQUESTS_COL(db, user.collegeId).doc(req.id);
  const issuedRef = issuedCol(db, user.collegeId).doc(req.id);
  const documentUrl = uploadedUrl || `/api/college/certificates/${req.id}/document`;
  const collegeSnap = await db.collection("colleges").doc(user.collegeId).get();
  let result!: CertificateRequest;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    const current = rowOf(snap);
    if (current.status !== "PENDING_ISSUANCE" || current.reservedNumber !== number) throw new CertificateStateConflictError("This request was just changed - refresh and try again.");
    if (!canDecide(user.uid, current.requesterUid, current.pendingRecipientUids)) throw new CertificationError("FORBIDDEN", "You can't issue this certificate", 403);

    const issued: Omit<IssuedCertificate, "id"> = {
      requestId: req.id, certificateNumber: number, verificationCode: code, typeId: req.certificateTypeId!, typeName: req.certificateTypeLabel,
      typeCode: req.certificateTypeCode ?? "", studentId: req.studentId, studentName: req.studentName, studentRollNumber: req.studentRollNumber,
      studentDepartment: req.studentDepartment, issuedAt: now.toISOString(), issuedByUid: user.uid, issuedByName: user.name, documentUrl,
      ...(uploadedUrl ? { uploadedPdf: true } : {}), ...(feeReceiptNo ? { feeReceiptNo } : {}), revoked: null,
    };
    tx.create(issuedRef, issued);
    if (!uploadedUrl) tx.set(issuedDocumentDoc(db, user.collegeId, req.id), { html: built.html, createdAt: now });
    tx.create(verificationsCol(db).doc(code), {
      collegeId: user.collegeId, issuedId: req.id, certificateNumber: number, typeName: req.certificateTypeLabel, studentName: req.studentName,
      studentRollNumber: req.studentRollNumber, collegeName: (collegeSnap.data() as { name?: string } | undefined)?.name ?? "", issuedAt: now.toISOString(), revoked: null,
    });
    const history = [...current.history, { action: "ISSUED", byUid: user.uid, byName: user.name, byRole: user.role, at: now, detail: number }];
    const update = {
      status: "ISSUED" as const, issuedByUid: user.uid, issuedByName: user.name, issuedAt: now, certificateNumber: number, certificateUrl: documentUrl,
      issuedCertificateId: req.id, issuerValues, ...(feeReceiptNo ? { feeReceiptNo } : {}), pendingRecipientUids: [] as string[], history, updatedAt: now, decidedAt: now,
    };
    tx.update(reqRef, update);
    tx.set(db.collection("colleges").doc(user.collegeId).collection("auditLogs").doc(), {
      collegeId: user.collegeId, action: "CERTIFICATE_ISSUED", performedBy: user.uid, performedByName: user.name, targetId: req.id,
      details: { certificateNumber: number, certificate: req.certificateTypeLabel, student: req.studentName }, timestamp: now,
    });
    result = { ...current, ...update } as CertificateRequest;
  });

  await notifications.resolveIssuanceNotifications(db, user.collegeId, id);
  await notifications.notifyStudent(
    db, user.collegeId, result.requesterUid, "CERTIFICATE_ISSUED", `${result.certificateTypeLabel} issued`,
    `Your ${result.certificateTypeLabel} (${number}) has been issued. Download it from Certificates.`,
  );
  return result;
}

// ─── Register, documents, revoking ─────────────────────────────────────────────────

export const REGISTER_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "EXAM_CELL"] as const;
export const ADMIN_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL"] as const;

export async function listRegister(db: Firestore, collegeId: string): Promise<IssuedCertificate[]> {
  const snap = await issuedCol(db, collegeId).orderBy("issuedAt", "desc").limit(3000).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<IssuedCertificate, "id">), id: d.id }));
}

/** The frozen copy - for the student it was issued to, the register roles and whoever issued it. */
export async function readIssuedDocument(db: Firestore, user: ActingUser, issuedId: string): Promise<{ issued: IssuedCertificate; html: string | null }> {
  const issued = await loadIssued(db, user.collegeId, issuedId);
  if (!issued) throw new CertificationError("NOT_FOUND", "Certificate not found", 404);
  let allowed = (REGISTER_ROLES as readonly string[]).includes(user.role) || issued.issuedByUid === user.uid;
  if (!allowed) {
    const req = await CERTIFICATE_REQUESTS_COL(db, user.collegeId).doc(issued.requestId).get();
    allowed = (req.data() as CertificateRequest | undefined)?.requesterUid === user.uid;
  }
  if (!allowed) throw new CertificationError("NOT_FOUND", "Certificate not found", 404);
  if (issued.uploadedPdf) return { issued, html: null };
  const doc = await issuedDocumentDoc(db, user.collegeId, issuedId).get();
  return { issued, html: (doc.data() as { html?: string } | undefined)?.html ?? null };
}

/** Withdraws an issued certificate: the register keeps it, marked; the QR check then says it was revoked. */
export async function revokeIssued(db: Firestore, user: ActingUser, issuedId: string, reason: string): Promise<IssuedCertificate> {
  const text = reason.trim().slice(0, 300);
  if (!text) throw new CertificationError("REMARKS_REQUIRED", "Give the reason for revoking", 400);
  const ref = issuedCol(db, user.collegeId).doc(issuedId);
  const now = new Date().toISOString();
  let result!: IssuedCertificate;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Certificate not found", 404);
    const issued = { ...(snap.data() as Omit<IssuedCertificate, "id">), id: snap.id };
    if (issued.revoked) throw new CertificateStateConflictError("This certificate is already revoked.");
    const reqRef = CERTIFICATE_REQUESTS_COL(db, user.collegeId).doc(issued.requestId);
    const reqSnap = await tx.get(reqRef);
    const revoked = { at: now, byName: user.name, reason: text };
    tx.update(ref, { revoked });
    tx.update(verificationsCol(db).doc(issued.verificationCode), { revoked });
    if (reqSnap.exists) {
      const history = [...((reqSnap.data() as CertificateRequest).history ?? []), { action: "REVOKED", byUid: user.uid, byName: user.name, byRole: user.role, at: new Date(), remarks: text }];
      tx.update(reqRef, { history, updatedAt: new Date() });
    }
    tx.set(db.collection("colleges").doc(user.collegeId).collection("auditLogs").doc(), {
      collegeId: user.collegeId, action: "CERTIFICATE_REVOKED", performedBy: user.uid, performedByName: user.name, targetId: issuedId,
      details: { certificateNumber: issued.certificateNumber, reason: text }, timestamp: new Date(),
    });
    result = { ...issued, revoked };
  });
  const req = await CERTIFICATE_REQUESTS_COL(db, user.collegeId).doc(result.requestId).get();
  const uid = (req.data() as CertificateRequest | undefined)?.requesterUid;
  if (uid) await notifications.notifyStudent(db, user.collegeId, uid, "CERTIFICATE_REVOKED", `${result.typeName} revoked`, `Your ${result.typeName} (${result.certificateNumber}) was revoked. Reason: ${text}`);
  return result;
}

/** Requests of one configured type, newest first (Setup shows whether a type is in use). */
export async function typeInUse(db: Firestore, collegeId: string, typeId: string): Promise<boolean> {
  const snap = await CERTIFICATE_REQUESTS_COL(db, collegeId).where("certificateTypeId", "==", typeId).limit(1).get();
  return !snap.empty;
}


// ─── Exam result check (Pass / Fail) ───────────────────────────────────────────────

/** PASS when the student's published results have no backlog, FAIL with the backlog codes, NO_RESULTS when none. */
export async function resultCheck(db: Firestore, collegeId: string, studentId: string): Promise<{ outcome: "PASS" | "FAIL" | "NO_RESULTS"; backlogs: string[] }> {
  const [{ rules }, sittings] = await Promise.all([loadResultRules(db, collegeId), loadPublishedSittings(db, collegeId, studentId)]);
  const view = buildStudentResults(sittings, rules);
  if (view.semesters.length === 0) return { outcome: "NO_RESULTS", backlogs: [] };
  const backlogs = view.backlogs.map((b) => b.subjectCode);
  return { outcome: backlogs.length ? "FAIL" : "PASS", backlogs };
}

// ─── Started by the College Office for a batch ────────────────────────────────────

export interface BatchGroup { key: string; department: string; year: number; section: string; status: string; count: number }
const groupKey = (s: { department?: string; year?: number; section?: string; status?: string }) =>
  `${s.department ?? ""}|${s.year ?? 0}|${s.section ?? ""}|${s.status || "REGULAR"}`;

/** The students to choose from, grouped by branch, year, section and status (studying / passed out ...). */
export async function batchGroups(db: Firestore, collegeId: string): Promise<BatchGroup[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("students").select("department", "year", "section", "status").get();
  const groups = new Map<string, BatchGroup>();
  for (const d of snap.docs) {
    const s = d.data() as Partial<StudentRecord>;
    const key = groupKey(s);
    const g = groups.get(key) ?? { key, department: s.department ?? "", year: s.year ?? 0, section: s.section ?? "", status: s.status || "REGULAR", count: 0 };
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.department.localeCompare(b.department) || a.year - b.year || a.section.localeCompare(b.section) || a.status.localeCompare(b.status));
}

/**
 * Starts one request per student of the chosen groups. A student who already has an open request of the type (or
 * holds an issued once-only one) is skipped and counted. dryRun counts without writing. Each approver gets one
 * summary notification, not one per student.
 */
export async function startBatch(
  db: Firestore, user: ActingUser, typeId: string, keys: string[], dryRun: boolean,
): Promise<{ started: number; skipped: { student: string; reason: string }[]; total: number }> {
  const type = await loadType(db, user.collegeId, typeId);
  if (!type) throw new CertificationError("NOT_FOUND", "Certificate type not found", 404);
  if (!type.isActive) throw new CertificationError("INVALID", "Switch this certificate on in Setup first", 400);
  if (type.startedBy !== "OFFICE") throw new CertificationError("INVALID", "Students apply for this certificate themselves", 400);
  const wanted = new Set(keys);
  if (wanted.size === 0) throw new CertificationError("INVALID", "Pick at least one class", 400);

  const col = db.collection("colleges").doc(user.collegeId).collection("students");
  const students = (await col.get()).docs.map((d) => ({ ...(d.data() as StudentRecord), id: d.id })).filter((s) => wanted.has(groupKey(s)));
  if (students.length > 2000) throw new CertificationError("INVALID", "At most 2000 students at a time - pick fewer classes", 400);
  const existing = (await CERTIFICATE_REQUESTS_COL(db, user.collegeId).where("certificateTypeId", "==", type.id).get()).docs.map(rowOf);
  const open = new Set(existing.filter((r) => OPEN.includes(r.status)).map((r) => r.studentId));
  const issued = new Set(existing.filter((r) => r.status === "ISSUED").map((r) => r.studentId));

  const skipped: { student: string; reason: string }[] = [];
  const todo = students.filter((s) => {
    const who = `${s.name} (${s.rollNumber || "no Regd. No"})`;
    if (open.has(s.id)) { skipped.push({ student: who, reason: "Already in progress" }); return false; }
    if (type.onceOnly && issued.has(s.id)) { skipped.push({ student: who, reason: "Already issued" }); return false; }
    return true;
  });
  if (dryRun) return { started: todo.length, skipped, total: students.length };

  const now = new Date();
  const notifyCount = new Map<string, number>();
  let batch = db.batch();
  let inBatch = 0;
  let started = 0;
  for (const s of todo) {
    const { steps, pendingRecipientUids } = await buildInitialStep(db, user.collegeId, type.flow, s.department, s.id);
    if (pendingRecipientUids.length === 0) { skipped.push({ student: `${s.name} (${s.rollNumber})`, reason: `No one is set to approve "${type.flow[0].label}"` }); continue; }
    const data = {
      collegeId: user.collegeId, certificateTypeKey: type.code, certificateTypeLabel: type.name,
      certificateTypeId: type.id, certificateTypeCode: type.code, issuer: type.issuer, templateId: type.templateId,
      issuerFields: type.issuerFields, feeAmount: type.feeAmount, fields: type.fields, values: {}, attachments: [],
      requesterUid: s.uid ?? "", requesterName: s.name, startedByUid: user.uid, startedByName: user.name,
      studentId: s.id, studentRollNumber: s.rollNumber, studentName: s.name,
      studentDepartment: s.department, studentYear: s.year, studentSection: s.section,
      status: "IN_PROGRESS", flow: type.flow, currentStepIndex: 0, steps, pendingRecipientUids,
      history: [{ action: "STARTED", byUid: user.uid, byName: user.name, byRole: user.role, at: now, detail: "Started by the College Office" }],
      createdAt: now, updatedAt: now,
    };
    batch.set(CERTIFICATE_REQUESTS_COL(db, user.collegeId).doc(), data);
    for (const uid of pendingRecipientUids) notifyCount.set(uid, (notifyCount.get(uid) ?? 0) + 1);
    started += 1;
    if (++inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
  }
  if (inBatch > 0) await batch.commit();

  await writeAuditLogSafe(db, user.collegeId, {
    action: "CERTIFICATE_BATCH_STARTED", performedBy: user.uid, performedByName: user.name, targetId: type.id,
    details: { certificate: type.name, started, skipped: skipped.length },
  });
  const sends: (() => Promise<unknown>)[] = [
    ...[...notifyCount].map(([uid, n]) => () => notifications.notifyStudent(db, user.collegeId, uid, "CERTIFICATE_STARTED", `${type.name} - ${n} waiting for you`,
      `The College Office started ${type.name} for ${n} student${n === 1 ? "" : "s"}. Clear them in Certificates.`, "/certificates")),
    ...todo.filter((s) => s.uid).map((s) => () => notifications.notifyStudent(db, user.collegeId, s.uid!, "CERTIFICATE_STARTED", `${type.name} started`,
      `The College Office started your ${type.name}. Follow each department's clearance in Certificates.`)),
  ];
  for (let i = 0; i < sends.length; i += 25) await Promise.all(sends.slice(i, i + 25).map((f) => f().catch(() => undefined)));
  return { started, skipped, total: students.length };
}
