import { formatDate, formatCurrency } from "@/lib/utils";
import { CANDIDATE_STAGE_LABELS } from "@/types";
import type { CandidateStage } from "@/types";
import {
  esc, entry, bullets, detail, detailTable, docLinkRow, renderSection, DOCUMENT_STYLES,
} from "@/lib/pdf/resumeTemplate";

interface QualificationLike {
  degree?: string;
  institution?: string;
  yearOfPassing?: string;
  percentageOrCGPA?: string;
  certificateUrl?: string;
}

interface ExperienceLike {
  organization?: string;
  designation?: string;
  fromDate?: string;
  toDate?: string;
  responsibilities?: string;
}

interface RelativeLike {
  name?: string;
  relationship?: string;
  workingLocation?: string;
  profession?: string;
  experience?: string;
}

interface ApplicationLike {
  position?: string;
  department?: string;
  currentStage?: CandidateStage;
  status?: string;
  negotiatedSalary?: number;
  dateOfJoining?: string;
}

export interface CandidateProfileData {
  name: string;
  email?: string;
  phone?: string;
  collegeName?: string;
  source?: string;
  referralName?: string;
  referralDescription?: string;
  residenceAddress?: string;
  permanentAddress?: string;
  resumeUrl?: string;
  certificates?: { name: string; url: string }[];

  fatherName?: string;
  motherName?: string;
  dateOfBirth?: string;
  gender?: string;
  maritalStatus?: string;
  spouseName?: string;
  bloodGroup?: string;
  religion?: string;
  caste?: string;
  subCaste?: string;
  aadharNo?: string;
  panNo?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;

  currentEmployer?: string;
  totalExperienceYears?: string;
  currentCTC?: string;
  expectedCTC?: string;
  noticePeriod?: string;
  references?: string;
  additionalInfo?: string;

  qualifications?: QualificationLike[];
  experiences?: ExperienceLike[];
  hasRelativesInSociety?: boolean;
  relatives?: RelativeLike[];

  researchProfile?: {
    firstAuthorPublications?: string;
    publicationsQ1OrHighIF?: string;
    reviewPublications?: string;
    totalPublicationsInclCoAuthor?: string;
    patentsPublished?: string;
    patentsGranted?: string;
    hIndex?: string;
    i10Index?: string;
    fundingReceived?: string;
    fundingApplied?: string;
    nationalExposure?: string;
    internationalExposure?: string;
    keyResearchSkills?: string;
  };

  applications?: ApplicationLike[];
}

const SOURCE_LABELS: Record<string, string> = {
  WALK_IN: "Walk-in",
  CAREERS_PAGE: "Careers Page",
  ADVERTISEMENT: "Advertisement",
  REFERRAL: "Referral",
};

// Deliberately not the resume's photo/avatar CV-style header - this is meant
// to read as a plain data page, not a formatted resume, so this template
// only overrides the header block and reuses everything else (section/entry/
// fact-grid layout) as-is from DOCUMENT_STYLES.
const PLAIN_HEADER_STYLES = `
  .plain-header { border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 10px; }
  .plain-title { font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px; }
  .plain-contact { text-align: left; white-space: normal; margin-top: 6px; }
`;

export function getCandidateProfileHTML(data: CandidateProfileData): string {
  const contactLines = [
    data.email ? `Email: ${esc(data.email)}` : "",
    data.collegeName ? `College: ${esc(data.collegeName)}` : "",
    data.phone ? `Mobile: ${esc(data.phone)}` : "",
    data.resumeUrl ? `<a href="${esc(data.resumeUrl)}" target="_blank" style="color:#1d4ed8;text-decoration:none;">View Uploaded Resume ↗</a>` : "",
  ].filter(Boolean);

  const primaryApplication = data.applications?.[0];
  const subtitle = [primaryApplication?.position, primaryApplication?.department].filter(Boolean).join(" · ");

  // ── Personal & contact details ──────────────────────────────────────────
  const personalBody = detailTable(
    detail("Father's Name", data.fatherName) +
    detail("Mother's Name", data.motherName) +
    detail("Date of Birth", data.dateOfBirth ? formatDate(new Date(data.dateOfBirth)) : "") +
    detail("Gender", data.gender) +
    detail("Marital Status", data.maritalStatus) +
    detail("Spouse Name", data.maritalStatus === "Married" ? data.spouseName : undefined) +
    detail("Blood Group", data.bloodGroup) +
    detail("Religion", data.religion) +
    detail("Caste / Category", data.caste) +
    detail("Sub-caste / Community", data.subCaste) +
    detail("Aadhaar No.", data.aadharNo) +
    detail("PAN No.", data.panNo) +
    detail("Emergency Contact Name", data.emergencyContactName) +
    detail("Emergency Contact Phone", data.emergencyContactPhone) +
    detail("Source", data.source ? (SOURCE_LABELS[data.source] ?? data.source) : undefined) +
    detail("Referred By", data.source === "REFERRAL" ? data.referralName : undefined) +
    detail("Referral Notes", data.source === "REFERRAL" ? data.referralDescription : undefined, true) +
    detail("Residence Address", data.residenceAddress, true) +
    detail("Permanent Address", data.permanentAddress, true)
  );

  // ── Education ────────────────────────────────────────────────────────────
  const educationBody = (data.qualifications ?? [])
    .filter((q) => q.degree || q.institution)
    .map((q) => {
      const cert = q.certificateUrl
        ? `<div class="doc-link"><a href="${esc(q.certificateUrl)}" target="_blank">View Certificate ↗</a></div>`
        : "";
      return entry(q.degree || "Qualification", q.yearOfPassing || "", q.institution || "", q.percentageOrCGPA || "") + cert;
    })
    .join("");

  // ── Work experience ──────────────────────────────────────────────────────
  const experienceBody = (data.experiences ?? [])
    .filter((e) => e.organization || e.designation)
    .map((e) =>
      entry(e.organization || "Employer", "", e.designation || "", [e.fromDate, e.toDate].filter(Boolean).join(" - ")) +
      bullets([e.responsibilities])
    )
    .join("");

  // ── Professional details ────────────────────────────────────────────────
  const professionalBody = detailTable(
    detail("Current / Previous Employer", data.currentEmployer) +
    detail("Total Experience (years)", data.totalExperienceYears) +
    detail("Current CTC", data.currentCTC ? formatCurrency(Number(data.currentCTC)) : "") +
    detail("Expected CTC", data.expectedCTC ? formatCurrency(Number(data.expectedCTC)) : "") +
    detail("Notice Period", data.noticePeriod) +
    detail("References", data.references, true) +
    detail("Additional Information", data.additionalInfo, true)
  );

  // ── Research profile ────────────────────────────────────────────────────
  const rp = data.researchProfile;
  const researchBody = rp ? bullets([
    rp.firstAuthorPublications && `Publications (first/corresponding author): ${esc(rp.firstAuthorPublications)}`,
    rp.publicationsQ1OrHighIF && `Publications in Q1 or IF > 4.0: ${esc(rp.publicationsQ1OrHighIF)}`,
    rp.reviewPublications && `Review Publications: ${esc(rp.reviewPublications)}`,
    rp.totalPublicationsInclCoAuthor && `Total Publications (incl. co-author): ${esc(rp.totalPublicationsInclCoAuthor)}`,
    rp.patentsPublished && `Patents Published: ${esc(rp.patentsPublished)}`,
    rp.patentsGranted && `Patents Granted: ${esc(rp.patentsGranted)}`,
    rp.hIndex && `H-Index: ${esc(rp.hIndex)}`,
    rp.i10Index && `i10-Index: ${esc(rp.i10Index)}`,
    rp.fundingReceived && `Funding Projects Received: ${esc(rp.fundingReceived)}`,
    rp.fundingApplied && `Funding Projects Applied: ${esc(rp.fundingApplied)}`,
    rp.nationalExposure && `National Exposure: ${esc(rp.nationalExposure)}`,
    rp.internationalExposure && `International Exposure: ${esc(rp.internationalExposure)}`,
    rp.keyResearchSkills && `Key Research Skills: ${esc(rp.keyResearchSkills)}`,
  ]) : "";

  // ── Relatives in society ────────────────────────────────────────────────
  const relativesBody = data.hasRelativesInSociety && data.relatives?.length
    ? data.relatives
        .filter((r) => r.name || r.workingLocation)
        .map((r) => entry(r.name || "Relative", r.experience || "", [r.relationship, r.profession].filter(Boolean).join(" · "), r.workingLocation || ""))
        .join("")
    : bullets([data.hasRelativesInSociety === false && "None declared"]);

  // ── Documents & certificates ────────────────────────────────────────────
  const documentsBody =
    docLinkRow("Resume / CV", data.resumeUrl) +
    (data.certificates ?? []).map((c) => docLinkRow(c.name, c.url)).join("");

  // ── Hiring applications ─────────────────────────────────────────────────
  const applicationsBody = (data.applications ?? [])
    .map((a) => {
      const stageLabel = a.currentStage ? CANDIDATE_STAGE_LABELS[a.currentStage] : "";
      return entry(
        a.position || "Position",
        a.status || "",
        [a.department, stageLabel].filter(Boolean).join(" · "),
        a.negotiatedSalary ? formatCurrency(a.negotiatedSalary) : ""
      ) + bullets([a.dateOfJoining && `Date of Joining: ${esc(formatDate(new Date(a.dateOfJoining)))}`]);
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${DOCUMENT_STYLES}${PLAIN_HEADER_STYLES}</style>
</head>
<body>
<div class="page">
  <div class="plain-header">
    <div class="plain-title">Candidate Profile</div>
    <div class="name">${esc(data.name)}</div>
    ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ""}
    ${data.collegeName ? `<div class="college">${esc(data.collegeName)}</div>` : ""}
    <div class="contact-block plain-contact">
      ${contactLines.map((l) => `<div>${l}</div>`).join("")}
    </div>
  </div>

  ${renderSection("Personal & Contact Details", personalBody)}
  ${renderSection("Educational Qualifications", educationBody)}
  ${renderSection("Work Experience", experienceBody)}
  ${renderSection("Professional Details", professionalBody)}
  ${renderSection("Research Profile", researchBody)}
  ${renderSection("Relatives Working in the Society", relativesBody)}
  ${renderSection("Documents & Certificates", documentsBody)}
  ${renderSection("Hiring Applications", applicationsBody)}

  <div class="footer">Generated on ${esc(formatDate(new Date()))} - Confidential, for internal institutional use only.</div>
</div>
</body>
</html>`;
}
