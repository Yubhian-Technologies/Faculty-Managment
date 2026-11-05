import type {
  BranchCheck, CertificateAttachmentDef, CertificateCategory, CertificateFieldDef, CertificateTemplate, CertificateTypeConfig, FlowStepDef, RecipientResolver, UserRole,
} from "@/types";

// Validation of a certificate type as the Principal / College Admin saves it (pure - the routes and the editor's live
// hints share it). Every list is cleaned, every key made unique, and anything malformed is refused with a message
// naming it, rather than silently dropped.

export const CERTIFICATE_CATEGORIES: { value: CertificateCategory; label: string }[] = [
  { value: "IDENTITY", label: "Bonafide & status" },
  { value: "ACADEMIC_RECORDS", label: "Academic records" },
  { value: "EXAMINATION", label: "Examination" },
  { value: "CLEARANCE", label: "Clearance" },
  { value: "FEE_FINANCE", label: "Fees & scholarships" },
  { value: "LETTERS", label: "Letters" },
];

/** Roles an approval step (or the issuer) can be. Labels are what the editor shows. */
export const APPROVER_ROLES: { role: UserRole; label: string }[] = [
  { role: "COLLEGE_OFFICE", label: "College Office" },
  { role: "PRINCIPAL", label: "Principal" },
  { role: "VICE_PRINCIPAL", label: "Vice Principal" },
  { role: "EXAM_CELL", label: "Exam Cell" },
  { role: "ACADEMICS", label: "Academics" },
  { role: "LIBRARY", label: "Library" },
  { role: "HOSTEL", label: "Hostel" },
  { role: "PLACEMENT_DEPT", label: "Placement Cell" },
  { role: "T_AND_P", label: "Training & Placement" },
  { role: "PD", label: "Physical Education" },
  { role: "COLLEGE_ACCOUNTS", label: "College Accounts" },
];
const ROLE_SET = new Set<string>(APPROVER_ROLES.map((r) => r.role));

export function recipientLabel(r: RecipientResolver): string {
  switch (r.kind) {
    case "ROLE": return APPROVER_ROLES.find((x) => x.role === r.role)?.label ?? r.role;
    case "STUDENT_DEPARTMENT_HOD": return "HOD of the student's department";
    case "STUDENT_MENTOR": return "Student's mentor";
    case "CLASS_INCHARGE": return "Class in-charge";
    case "USER": return r.name;
  }
}

const KEY_RE = /^[a-z][a-zA-Z0-9]{0,39}$/;
const keyOf = (label: string) => {
  const words = label.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const k = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
  return /^[a-z]/.test(k) ? k.slice(0, 40) : `f${k}`.slice(0, 40);
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function cleanRecipient(raw: unknown): Result<RecipientResolver> {
  const r = (raw ?? {}) as Partial<RecipientResolver> & { role?: string; uid?: string; name?: string };
  switch (r.kind) {
    case "ROLE": return ROLE_SET.has(String(r.role)) ? { ok: true, value: { kind: "ROLE", role: r.role as UserRole } } : fail("Pick who approves");
    case "STUDENT_DEPARTMENT_HOD": case "STUDENT_MENTOR": case "CLASS_INCHARGE": return { ok: true, value: { kind: r.kind } };
    case "USER": return r.uid && str(r.name) ? { ok: true, value: { kind: "USER", uid: String(r.uid), name: str(r.name) } } : fail("Pick the person who approves");
    default: return fail("Pick who approves");
  }
}

export function cleanFields(raw: unknown, what: string): Result<CertificateFieldDef[]> {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail(`${what} must be a list`);
  const out: CertificateFieldDef[] = [];
  for (const f of raw as Partial<CertificateFieldDef>[]) {
    const label = str(f?.label, 80);
    if (!label) return fail(`Every ${what.toLowerCase()} needs a label`);
    let key = str(f?.key, 40) || keyOf(label);
    if (!KEY_RE.test(key)) key = keyOf(label);
    while (out.some((o) => o.key === key)) key = `${key.slice(0, 37)}${out.length}`;
    const kind = (["text", "textarea", "date", "number", "select"] as const).includes(f?.kind as never) ? f!.kind! : "text";
    const options = kind === "select" ? (Array.isArray(f?.options) ? f!.options!.map((o) => str(o, 80)).filter(Boolean) : []) : undefined;
    if (kind === "select" && (!options || options.length === 0)) return fail(`"${label}" needs at least one option`);
    out.push({ key, label, kind, required: f?.required === true, ...(options ? { options } : {}), ...(str(f?.defaultValue) ? { defaultValue: str(f?.defaultValue) } : {}) });
  }
  if (out.length > 20) return fail(`At most 20 ${what.toLowerCase()}`);
  return { ok: true, value: out };
}

function cleanAttachments(raw: unknown): Result<CertificateAttachmentDef[]> {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail("Attachments must be a list");
  const out: CertificateAttachmentDef[] = [];
  for (const a of raw as Partial<CertificateAttachmentDef>[]) {
    const label = str(a?.label, 80);
    if (!label) return fail("Every attachment needs a label");
    let key = str(a?.key, 40) || keyOf(label);
    if (!KEY_RE.test(key)) key = keyOf(label);
    while (out.some((o) => o.key === key)) key = `${key.slice(0, 37)}${out.length}`;
    out.push({ key, label, required: a?.required === true });
  }
  if (out.length > 5) return fail("At most 5 attachments");
  return { ok: true, value: out };
}

export function cleanFlow(raw: unknown): Result<FlowStepDef[]> {
  if (!Array.isArray(raw) || raw.length === 0) return fail("Add at least one approval step");
  if (raw.length > 8) return fail("At most 8 approval steps");
  const out: FlowStepDef[] = [];
  for (const [i, s] of (raw as Partial<FlowStepDef & { branches?: unknown[]; recipient?: unknown }>[]).entries()) {
    const label = str(s?.label, 80) || `Step ${i + 1}`;
    const id = str(s?.id, 40) || `step${i + 1}`;
    if (s?.type === "PARALLEL") {
      const branches = Array.isArray(s.branches) ? s.branches : [];
      if (branches.length < 2) return fail(`"${label}": approvals at the same time need at least two approvers`);
      if (branches.length > 25) return fail(`"${label}": at most 25 departments`);
      const cleanBranches = [];
      for (const [j, b] of (branches as { key?: string; label?: string; recipient?: unknown; check?: string }[]).entries()) {
        const rec = cleanRecipient(b?.recipient);
        if (!rec.ok) return fail(`"${label}": ${rec.error}`);
        const check: BranchCheck | undefined = b?.check === "DUES" || b?.check === "RESULT" ? b.check : undefined;
        cleanBranches.push({ key: str(b?.key, 40) || `b${j + 1}`, label: str(b?.label, 80) || recipientLabel(rec.value), recipient: rec.value, ...(check ? { check } : {}) });
      }
      if (new Set(cleanBranches.map((b) => b.key)).size !== cleanBranches.length) return fail(`"${label}": each approver must be listed once`);
      out.push({ id, type: "PARALLEL", label, branches: cleanBranches });
    } else {
      const rec = cleanRecipient(s?.recipient);
      if (!rec.ok) return fail(`"${label}": ${rec.error}`);
      out.push({ id, type: "SEQUENTIAL", label, recipient: rec.value });
    }
  }
  if (new Set(out.map((s) => s.id)).size !== out.length) out.forEach((s, i) => { s.id = `step${i + 1}`; });
  return { ok: true, value: out };
}

/** "VIT/BON/2026/0007" from "VIT/{CODE}/{YYYY}/{SEQ}". */
export function formatCertificateNumber(format: string, parts: { code: string; year: number; academicYear: string; seq: number }): string {
  return format
    .replace(/\{CODE\}/g, parts.code)
    .replace(/\{YYYY\}/g, String(parts.year))
    .replace(/\{AY\}/g, parts.academicYear)
    .replace(/\{SEQ\}/g, String(parts.seq).padStart(4, "0"));
}

export const DEFAULT_NUMBER_FORMAT = "{CODE}/{YYYY}/{SEQ}";

/** Validates the editable part of a certificate type; `templateIds` = the college's templates. */
export function cleanTypeConfig(raw: unknown, templateIds: Set<string>): Result<Omit<CertificateTypeConfig, "id" | "updatedAt" | "updatedByName">> {
  const t = (raw ?? {}) as Partial<CertificateTypeConfig>;
  const name = str(t.name, 120);
  if (!name) return fail("Give the certificate a name");
  const code = str(t.code, 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return fail("Give a short code (letters / digits) - it goes in the certificate number");
  const category = CERTIFICATE_CATEGORIES.some((c) => c.value === t.category) ? t.category! : "LETTERS";
  const fields = cleanFields(t.fields, "Form fields");
  if (!fields.ok) return fields;
  const issuerFields = cleanFields(t.issuerFields, "Issuer fields");
  if (!issuerFields.ok) return issuerFields;
  const attachments = cleanAttachments(t.attachments);
  if (!attachments.ok) return attachments;
  const flow = cleanFlow(t.flow);
  if (!flow.ok) return flow;
  const issuer = cleanRecipient(t.issuer);
  if (!issuer.ok) return fail(`Issuer: ${issuer.error}`);
  const templateId = str(t.templateId, 60);
  if (!templateId || !templateIds.has(templateId)) return fail("Pick a template");
  const numberFormat = str(t.numberFormat, 60) || DEFAULT_NUMBER_FORMAT;
  if (!numberFormat.includes("{SEQ}")) return fail("The certificate number format must contain {SEQ}");
  const feeAmount = Number(t.feeAmount ?? 0);
  if (!Number.isFinite(feeAmount) || feeAmount < 0 || feeAmount > 100000) return fail("The fee must be between 0 and 1,00,000");
  const statuses = Array.isArray(t.eligibility?.statuses) ? t.eligibility!.statuses.filter((s) => ["REGULAR", "GRADUATED", "DETAINED", "DISCONTINUED"].includes(s)) : [];
  const years = Array.isArray(t.eligibility?.years) ? t.eligibility!.years.map(Number).filter((y) => Number.isInteger(y) && y >= 1 && y <= 6) : [];
  const purposes = Array.isArray(t.purposes) ? Array.from(new Set(t.purposes.map((p) => str(p, 80)).filter(Boolean))).slice(0, 20) : [];
  return {
    ok: true,
    value: {
      code, name, category, description: str(t.description, 500) || undefined, isActive: t.isActive === true,
      eligibility: { statuses, years }, purposes, allowOtherPurpose: t.allowOtherPurpose === true,
      fields: fields.value, attachments: attachments.value, onceOnly: t.onceOnly === true, feeAmount: Math.round(feeAmount),
      flow: flow.value, issuer: issuer.value, templateId, issuerFields: issuerFields.value, numberFormat,
      signatureId: str(t.signatureId, 60) || undefined,
      delivery: (["DIGITAL", "PHYSICAL", "BOTH"] as const).includes(t.delivery as never) ? t.delivery! : "BOTH",
      startedBy: t.startedBy === "OFFICE" ? "OFFICE" : "STUDENT",
      ...(t.catalogKey ? { catalogKey: str(t.catalogKey, 40) } : {}),
    },
  };
}

/** May this student request this type? null = yes, else the reason shown to them. */
export function eligibilityProblem(t: Pick<CertificateTypeConfig, "eligibility" | "isActive">, student: { status?: string; year?: number }): string | null {
  if (!t.isActive) return "This certificate isn't available right now";
  const status = student.status || "REGULAR";
  if (t.eligibility.statuses.length && !t.eligibility.statuses.includes(status as never)) {
    return status === "GRADUATED" ? "This certificate is for current students" : "This certificate is issued only after you complete the course";
  }
  if (t.eligibility.years.length && !t.eligibility.years.includes(Number(student.year))) {
    return `This certificate is for year ${t.eligibility.years.join(" / ")} students`;
  }
  return null;
}

/**
 * The student's answers (or the issuer's entries) checked against a type's fields: unknown keys are dropped,
 * required ones must be filled, a select must be one of its options, numbers / dates must parse. Issuer fields
 * fall back to their default value when left blank.
 */
export function cleanValues(fields: CertificateFieldDef[], raw: unknown, useDefaults = false): Result<Record<string, string>> {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const fd of fields) {
    let v = typeof input[fd.key] === "string" || typeof input[fd.key] === "number" ? String(input[fd.key]).trim() : "";
    if (!v && useDefaults && fd.defaultValue) v = fd.defaultValue;
    if (!v) {
      if (fd.required) return fail(`Fill in "${fd.label}"`);
      continue;
    }
    if (v.length > (fd.kind === "textarea" ? 2000 : 300)) return fail(`"${fd.label}" is too long`);
    if (fd.kind === "number" && !Number.isFinite(Number(v))) return fail(`"${fd.label}" must be a number`);
    if (fd.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fail(`"${fd.label}" must be a date`);
    if (fd.kind === "select" && !(fd.options ?? []).includes(v)) return fail(`Pick one of the options for "${fd.label}"`);
    out[fd.key] = v;
  }
  return { ok: true, value: out };
}

/** The purpose a student gives: one of the type's list, or their own text when "Other" is allowed. */
export function cleanPurpose(t: Pick<CertificateTypeConfig, "purposes" | "allowOtherPurpose">, purpose: unknown, other: unknown): Result<string | null> {
  if (t.purposes.length === 0 && !t.allowOtherPurpose) return { ok: true, value: null };
  const p = str(purpose, 80);
  if (p && t.purposes.includes(p)) return { ok: true, value: p };
  if (t.allowOtherPurpose && (p === "Other" || t.purposes.length === 0)) {
    const o = str(other, 120);
    return o ? { ok: true, value: o } : fail("Describe the purpose");
  }
  return fail("Pick a purpose");
}

/** Validates a template as the Principal / College Admin saves it. */
export function cleanTemplate(raw: unknown): Result<Omit<CertificateTemplate, "id" | "updatedAt">> {
  const t = (raw ?? {}) as Partial<CertificateTemplate>;
  const name = str(t.name, 120);
  if (!name) return fail("Give the template a name");
  const kind = (["LETTER", "FORM", "MARKS", "UPLOAD"] as const).includes(t.kind as never) ? t.kind! : null;
  if (!kind) return fail("Pick the template kind");
  const title = str(t.title, 120);
  if (!title) return fail("Give the heading printed on the certificate");
  const body = str(t.body, 6000);
  const footer = str(t.footer, 1500);
  if (kind === "LETTER" && !body && t.showClearances !== true) return fail("Write the certificate text");
  let rows: { label: string; value: string }[] | undefined;
  if (kind === "FORM") {
    rows = (Array.isArray(t.rows) ? t.rows : []).map((r) => ({ label: str(r?.label, 120), value: str(r?.value, 400) })).filter((r) => r.label);
    if (rows.length === 0) return fail("Add at least one row");
    if (rows.length > 40) return fail("At most 40 rows");
  }
  const marksKind = kind === "MARKS" ? ((["SEMESTER", "CONSOLIDATED", "TRANSCRIPT"] as const).includes(t.marksKind as never) ? t.marksKind! : null) : undefined;
  if (marksKind === null) return fail("Pick which marks statement");
  return {
    ok: true,
    value: {
      name, kind, title, showQr: t.showQr !== false, ...(t.showClearances === true && kind !== "UPLOAD" ? { showClearances: true } : {}),
      ...(body && kind !== "UPLOAD" && kind !== "FORM" ? { body } : {}),
      ...(rows ? { rows } : {}), ...(marksKind ? { marksKind } : {}), ...(footer && kind !== "UPLOAD" ? { footer } : {}),
      ...(t.catalogKey ? { catalogKey: str(t.catalogKey, 40) } : {}),
    },
  };
}

/** Is this login named (as a person) in the type's approval steps or as its issuer? */
export function namesUser(t: Pick<CertificateTypeConfig, "flow" | "issuer">, uid: string): boolean {
  const is = (r: RecipientResolver) => r.kind === "USER" && r.uid === uid;
  return is(t.issuer) || t.flow.some((s) => (s.type === "SEQUENTIAL" ? is(s.recipient) : s.branches.some((b) => is(b.recipient))));
}
