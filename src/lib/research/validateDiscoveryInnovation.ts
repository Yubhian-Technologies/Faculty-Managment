import type { IprApplicant, IprInventor, IprStatus } from "@/types";

interface DiscoveryInnovationRequiredFields {
  datePublished?: string;
  dateGranted?: string;
  sdgGoals?: number[];
  applicantsCount?: number;
  applicants?: IprApplicant[];
  inventorsCount?: number;
  inventors?: IprInventor[];
  isStudentPatent?: "YES" | "NO";
  studentName?: string;
  studentRegistrationNumber?: string;
  studentDepartment?: string;
  publishedProofUrl?: string;
  grantedProofUrl?: string;
}

// Every Discovery & Innovation (IPR) field is compulsory except
// Commercialization (isCommercialized and everything under it) - mirrors
// the client-side isValid check in DiscoveryInnovationModuleView.tsx.
// Call with `inventors` already run through finalizeIprInventors() so an
// Internal inventor's name/facultyId reflect the server-verified record,
// not whatever the client claimed.
export function validateDiscoveryInnovationBody(
  body: DiscoveryInnovationRequiredFields, iprStatus: IprStatus
): string | null {
  if (!body.datePublished) return "Date of Published is required";
  if (iprStatus === "GRANTED" && !body.dateGranted) return "Date of Granted is required";
  if (!body.isStudentPatent) return "Student Patent is required";
  if (body.isStudentPatent === "YES") {
    if (!body.studentName?.trim()) return "Student Name is required for a student patent";
    if (!body.studentRegistrationNumber?.trim()) return "Student Regd. No. is required for a student patent";
    if (!body.studentDepartment?.trim()) return "Student Department is required for a student patent";
  }
  if (!body.sdgGoals?.length) return "At least one SDG must be mapped";
  if (!body.applicantsCount || !body.applicants?.length) return "At least one Applicant is required";
  if (body.applicants.some((a) => !a.name?.trim())) return "Every Applicant needs a name";
  if (!body.inventorsCount || !body.inventors?.length) return "At least one Inventor is required";
  for (const inv of body.inventors) {
    if (!inv.name?.trim()) return "Every Inventor needs a name";
    if (!inv.affiliationCollegeName?.trim()) return "Every Inventor needs an Affiliation";
  }
  if (!body.publishedProofUrl) return "Published Proof is required";
  if (iprStatus === "GRANTED" && !body.grantedProofUrl) return "Granted Proof is required";
  return null;
}
