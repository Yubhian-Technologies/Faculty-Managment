// The purpose a student submits a certificate request for - a controlled
// list (so approvers see a consistent reason, not free-form text) with an
// "Other" escape hatch for anything not covered. Shared by the submit API
// (validation, in service.ts) and the student's request form (the
// dropdown, in RequestForm.tsx), so both stay in lockstep with no second
// list to drift out of sync.

export const CERTIFICATE_PURPOSE_OPTIONS = [
  { code: "HIGHER_STUDIES", label: "Higher Studies / Further Education" },
  { code: "EDUCATION_LOAN", label: "Education Loan" },
  { code: "SCHOLARSHIP", label: "Scholarship Application" },
  { code: "PASSPORT", label: "Passport Application" },
  { code: "VISA", label: "Visa Application" },
  { code: "EMPLOYMENT", label: "Employment / Job Application" },
  { code: "BANK_KYC", label: "Bank Account / KYC" },
  { code: "OTHER", label: "Other" },
] as const;

export type CertificatePurposeCode = (typeof CERTIFICATE_PURPOSE_OPTIONS)[number]["code"];

const PURPOSE_LABEL_BY_CODE = new Map(CERTIFICATE_PURPOSE_OPTIONS.map((p) => [p.code, p.label]));

/**
 * Resolves a submitted purposeCode (+ free text when it's OTHER) into the
 * label stored on the request. Throws a plain Error with a user-facing
 * message on anything invalid - service.ts wraps it as a CertificationError
 * so the route returns 400.
 */
export function resolvePurpose(code: unknown, otherText?: unknown): { purposeCode: string; purpose: string } {
  const purposeCode = typeof code === "string" ? code.trim() : "";
  const label = PURPOSE_LABEL_BY_CODE.get(purposeCode as CertificatePurposeCode);
  if (!label) throw new Error("Please select a valid purpose");
  if (purposeCode === "OTHER") {
    const custom = typeof otherText === "string" ? otherText.trim() : "";
    if (!custom) throw new Error("Please describe the purpose");
    return { purposeCode, purpose: custom };
  }
  return { purposeCode, purpose: label };
}
