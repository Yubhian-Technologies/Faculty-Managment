interface ConsultancyRequiredFields {
  title?: string;
  department?: string;
  clientName?: string;
  clientType?: string;
  consultancyCategory?: string;
  problemStatement?: string;
  projectStatus?: "ONGOING" | "COMPLETED";
  startDate?: string;
  endDate?: string;
  durationMonths?: number;
  deliverables?: string[];
  completionReportUrl?: string;
}

// Every section of a consultancy project is compulsory except Financials
// (amounts, infrastructure usage, hours, shares) - mirrors the client-side
// isValid in ConsultancyProjectsModuleView.tsx. Deliverables & Reports are only
// asked once the project is Completed. The proofs of faculty share / income
// belong with the optional financials, so they stay optional too.
// `consultantCount` is the number of Faculty IDs that actually resolved.
export function validateConsultancyBody(body: ConsultancyRequiredFields, consultantCount: number): string | null {
  if (!body.title?.trim()) return "Title of the Consultancy Project is required";
  if (consultantCount < 1) return "At least one Faculty Consultant ID is required";
  if (!body.department?.trim()) return "Department is required";
  if (!body.clientName?.trim() || !body.clientType || !body.consultancyCategory) {
    return "Client / Organization, Client Type and Consultancy Category are required";
  }
  if (!body.problemStatement?.trim()) return "Problem Statement is required";
  if (body.projectStatus !== "ONGOING" && body.projectStatus !== "COMPLETED") {
    return "Status of Consultancy Project is required";
  }
  if (!body.startDate) return "Start Date is required";
  if (!body.endDate) return body.projectStatus === "ONGOING" ? "Tentative End Date is required" : "End Date is required";
  if (body.durationMonths === undefined || body.durationMonths === null || Number.isNaN(body.durationMonths)) {
    return "Duration (Months) is required";
  }
  if (body.projectStatus === "COMPLETED") {
    if (!body.deliverables?.length) return "Select at least one Deliverable";
    if (!body.completionReportUrl) return "Completion Report is required";
  }
  return null;
}
