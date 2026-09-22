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
  seedFundTitle?: string;
  seedFundAmountSanctioned?: number | null;
  seedFundSanctionDate?: string;
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
}

// A real calendar date typed as DD-MM-YYYY (so 31-02-2025 is rejected).
export function isValidDdMmYyyy(v: string | undefined): boolean {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v ?? "");
  if (!m) return false;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
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

// Each year answers "Submitted All Required Documents to Sponsoring Agency"
// itself; a Yes needs that year's date and reports. Returns the message for
// the first year that falls short, or null.
function yearDocumentsError(
  years: SponsoredProjectYearData[], sanctionedStatus: SponsoredProjectSanctionedStatus
): string | null {
  const isOngoing = sanctionedStatus === "ONGOING";
  for (let i = 0; i < years.length; i++) {
    const y = years[i];
    const at = `Year ${i + 1}`;
    if (!y.submittedRequiredDocs) return `${at}: Submitted Required Documents to Sponsoring Agency is required`;
    if (y.submittedRequiredDocs !== "YES") continue;
    if (!y.dateOfSubmission) return `${at}: Date of Submission is required`;
    if (isOngoing ? !y.progressReportUrl : !y.completionReportUrl) {
      return `${at}: ${isOngoing ? "Progress Report" : "Completion Report"} is required`;
    }
    if (!y.utilizationCertificateUrl || !y.statementOfExpenditureUrl) {
      return `${at}: Utilization Certificate and Statement of Expenditure are required`;
    }
  }
  return null;
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
    if (body.extendedToSeedFund === "YES") {
      if (!body.seedFundTitle?.trim()) return "Title of Seed Funding is required";
      if (body.seedFundAmountSanctioned == null || Number.isNaN(body.seedFundAmountSanctioned)) {
        return "Seed Funding Amount Sanctioned is required";
      }
      if (!isValidDdMmYyyy(body.seedFundSanctionDate)) return "Year of Sanctioning must be a valid date in DD-MM-YYYY format";
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
  return yearDocumentsError(body.yearlyData, body.sanctionedStatus);
}
