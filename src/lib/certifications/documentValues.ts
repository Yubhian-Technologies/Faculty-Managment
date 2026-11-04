import type { CertificateRequest, StudentRecord } from "@/types";
import { toRoman } from "@/lib/academic/format";

// The placeholder values of one certificate (pure): the student record, the request, the issuer's entries and the
// numbering. Dates print day-first (05-11-2026), the year of study in Roman numerals (III), and the pronouns follow
// the recorded gender ("he / she" when none is recorded).

export function displayDate(v: string | Date | undefined | null): string {
  if (!v) return "";
  if (v instanceof Date) {
    const ist = new Date(v.getTime() + 330 * 60_000);
    return `${String(ist.getUTCDate()).padStart(2, "0")}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${ist.getUTCFullYear()}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

function pronouns(gender: string | undefined) {
  const g = (gender ?? "").trim().toLowerCase();
  if (g === "male" || g === "m") return { heShe: "he", hisHer: "his", himHer: "him", sonDaughter: "son", MrMs: "Mr." };
  if (g === "female" || g === "f") return { heShe: "she", hisHer: "her", himHer: "her", sonDaughter: "daughter", MrMs: "Ms." };
  return { heShe: "he / she", hisHer: "his / her", himHer: "him / her", sonDaughter: "son / daughter", MrMs: "Mr. / Ms." };
}

export interface ValueInputs {
  student: Partial<StudentRecord>;
  request: Pick<CertificateRequest, "purpose" | "values" | "createdAt" | "feeReceiptNo"> & { studentName?: string; studentRollNumber?: string; studentDepartment?: string };
  issuerValues?: Record<string, string>;
  academicYear: string;
  cgpa?: string;
  certificateNumber?: string;
  issueDate: Date;
}

const toDate = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  const t = v as { toDate?: () => Date } | undefined;
  return t?.toDate ? t.toDate() : null;
};

export function buildCertificateValues(i: ValueInputs): Record<string, string> {
  const s = i.student;
  const graduated = s.status === "GRADUATED" || s.status === "DISCONTINUED";
  const address = s.permanentAddressSameAsTemporary ? s.temporaryAddress : (s.permanentAddress || s.temporaryAddress);
  const values: Record<string, string> = {
    studentName: s.name || i.request.studentName || "",
    rollNumber: s.rollNumber || i.request.studentRollNumber || "",
    admissionNo: s.admissionNo ?? "",
    fatherName: s.fatherName ?? "",
    motherName: s.motherName ?? "",
    gender: s.gender ?? "",
    ...pronouns(s.gender),
    dateOfBirth: displayDate(s.dateOfBirth),
    nationality: s.nationality ?? "",
    religion: String(s.religion ?? ""),
    caste: String(s.caste ?? ""),
    permanentAddress: address ?? "",
    dateOfAdmission: displayDate(s.dateOfAdmission),
    course: s.course ?? "",
    branch: s.department || i.request.studentDepartment || "",
    year: s.year ? toRoman(s.year) : "",
    section: s.section ?? "",
    academicYear: i.academicYear,
    batch: s.batch ?? "",
    regulation: s.regulation ?? "",
    studentStatus: graduated ? "has studied" : "is studying",
    cgpa: i.cgpa ?? "",
    purpose: i.request.purpose ?? "",
    requestDate: displayDate(toDate(i.request.createdAt)),
    issueDate: displayDate(i.issueDate),
    feeReceiptNo: i.request.feeReceiptNo ?? "",
    certificateNumber: i.certificateNumber ?? "",
  };
  // The student's form answers and the issuer's entries, dates shown day-first; they never replace a record value.
  for (const src of [i.request.values ?? {}, i.issuerValues ?? {}]) {
    for (const [k, v] of Object.entries(src)) if (!(k in values) || !values[k]) values[k] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? displayDate(v) : v;
  }
  return values;
}
