import type {
  SponsoredProjectCoPI, SponsoredProjectSanctionedStatus, SponsoredProjectStatus, SponsoredProjectYearData,
} from "@/types";

interface SponsoredProjectRequiredFields {
  durationMonths?: number;
  tentativeOutcomes?: string;
  piDepartment?: string;
  piAffiliation?: string;
  coPiCount?: number;
  coPis?: SponsoredProjectCoPI[];
  projectStatus?: SponsoredProjectStatus;
  dateProposalSubmitted?: string;
  amountApplied?: number;
  extendedToSeedFund?: "YES" | "NO";
  sanctionedStatus?: SponsoredProjectSanctionedStatus;
  dateProjectSanctioned?: string;
  dateOfStart?: string;
  financialYearOfStart?: string;
  totalAmountSanctioned?: number;
  recurringAmountSanctioned?: number;
  nonRecurringAmountSanctioned?: number;
  instituteContributionSanctioned?: number;
  dateOfCompletion?: string;
  financialYearOfCompletion?: string;
  noOfYears?: number;
  yearlyData?: SponsoredProjectYearData[];
  progressReportUrl?: string;
  completionReportUrl?: string;
  utilizationCertificateUrl?: string;
  statementOfExpenditureUrl?: string;
  submittedRequiredDocs?: "YES" | "NO";
  dateOfSubmission?: string;
}

function isYearDataComplete(y: SponsoredProjectYearData): boolean {
  const nums = [
    y.totalAmountReceived, y.recurringAmountReceived, y.nonRecurringAmountReceived, y.instituteContributionReceived,
    y.studentsProjectsUG, y.studentsProjectsPG, y.studentsProjectsPhD, y.studentsTrainedCount,
    y.teachingStaffTrainedCount, y.nonTeachingStaffTrainedCount, y.externalPersonsTrainedCount,
  ];
  if (nums.some((v) => v === undefined || Number.isNaN(v))) return false;
  if (!y.infrastructureProcured?.length || y.infrastructureProcured.some((it) => !it.name?.trim())) return false;
  if (!y.papersPublished?.length || y.papersPublished.some((p) => !p.title?.trim())) return false;
  if (!y.patents?.length || y.patents.some((p) => !p.patentTitle?.trim())) return false;
  return true;
}

// Almost every Sponsored Research Project field is compulsory - mirrors the
// client-side isValid check in SponsoredProjectsModuleView.tsx. Amount
// Received / Infrastructure / Outcomes (Papers/Patents/Students & Training)
// are broken down per year (yearlyData, one entry per noOfYears) and each
// year must be fully filled in.
export function validateSponsoredProjectBody(body: SponsoredProjectRequiredFields): string | null {
  if (body.durationMonths === undefined || Number.isNaN(body.durationMonths)) return "Duration (Months) is required";
  if (!body.tentativeOutcomes?.trim()) return "Tentative Outcomes of Project is required";
  if (!body.piDepartment?.trim() || !body.piAffiliation?.trim()) return "Dept. and Affiliation of PI are required";
  if (body.coPiCount) {
    if (!body.coPis?.length || body.coPis.some((c) => !c.name?.trim() || !c.department?.trim() || !c.affiliation?.trim())) {
      return "Every Co-PI needs a Name, Department and Affiliation";
    }
  }

  if (body.projectStatus === "APPLIED") {
    if (!body.dateProposalSubmitted || body.amountApplied === undefined || Number.isNaN(body.amountApplied) || !body.extendedToSeedFund) {
      return "Date of Proposal Submitted, Amount Applied and Extended to Seed Fund are required";
    }
    return null;
  }

  if (!body.sanctionedStatus) return "Ongoing / Completed is required";
  if (!body.dateProjectSanctioned || !body.dateOfStart || !body.financialYearOfStart?.trim()) {
    return "Date of Project Sanctioned, Date of Start and F.Y. of Start are required";
  }
  if (body.sanctionedStatus === "COMPLETED" && (!body.dateOfCompletion || !body.financialYearOfCompletion?.trim())) {
    return "Date of Completion and F.Y. of Completion are required";
  }
  const sanctionedAmounts = [body.totalAmountSanctioned, body.recurringAmountSanctioned, body.nonRecurringAmountSanctioned, body.instituteContributionSanctioned];
  if (sanctionedAmounts.some((v) => v === undefined || Number.isNaN(v))) return "Amount Sanctioned fields are required";
  if (!body.noOfYears || Number.isNaN(body.noOfYears) || body.noOfYears <= 0) return "No. of Years is required";
  if (!body.yearlyData || body.yearlyData.length !== body.noOfYears || body.yearlyData.some((y) => !isYearDataComplete(y))) {
    return "Every year's Amount Received, Infrastructure Procured, Outcomes, Papers Published, Patents and Students & Training are required";
  }
  if (!body.submittedRequiredDocs) return "Submitted Required Documents to Sponsoring Agency is required";
  if (body.submittedRequiredDocs === "YES") {
    if (!body.dateOfSubmission) return "Date of Submission is required";
    if (body.sanctionedStatus === "ONGOING" ? !body.progressReportUrl : !body.completionReportUrl) {
      return body.sanctionedStatus === "ONGOING" ? "Progress Report is required" : "Completion Report is required";
    }
    if (!body.utilizationCertificateUrl || !body.statementOfExpenditureUrl) {
      return "Utilization Certificate and Statement of Expenditure are required";
    }
  }
  return null;
}
