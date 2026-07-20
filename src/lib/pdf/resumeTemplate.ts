import { formatCurrency, formatDate } from "@/lib/utils";
import { DESIGNATION_LABELS, EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS, ROLE_LABELS } from "@/types";

type TimestampLike = { toDate?: () => Date; seconds?: number; _seconds?: number } | string | null | undefined;

interface DegreeDetail {
  degreeAndBranch?: string;
  universityOrInstitute?: string;
  percentageOrDivision?: string;
  yearOfCompletion?: number;
}

interface CourseAssignment {
  code?: string;
  name?: string;
  weeklyCreditHours?: number;
}

interface TeachingAssignmentSummary {
  primaryTeachingRole?: string;
  courses?: CourseAssignment[];
}

interface FundedProject {
  title?: string;
  fundingAgency?: string;
  grantAmountLakhs?: number;
  year?: number;
  status?: string;
}

interface ConsultancyProject {
  title?: string;
  clientOrAgency?: string;
  revenueLakhs?: number;
  year?: number;
  status?: string;
}

interface PatentSummary {
  indianFiled?: number;
  indianPublished?: number;
  indianGranted?: number;
  internationalFiled?: number;
  internationalPublished?: number;
  internationalGranted?: number;
  details?: string;
}

interface LabEstablished {
  facilityDetails?: string;
  outcomes?: string;
}

interface AuthoredBook {
  title?: string;
  publisher?: string;
  year?: number;
}

interface FacultyProfileFieldsLike {
  highestQualification?: string;
  ugDetails?: DegreeDetail;
  pgDetails?: DegreeDetail;
  phdDetails?: DegreeDetail;
  phdStatus?: string;
  phdMode?: string;
  phdSupervisorName?: string;
  fellowshipsReceived?: string;
  gateQualifiedYear?: number;
  gateScore?: number;
  netSletQualificationYear?: number;

  teachingExperienceBeforeJoiningYears?: number;
  teachingExperienceSinceJoiningYears?: number;
  researchOrIndustryExperienceYears?: number;
  totalProfessionalExperienceYears?: number;
  totalWeeklyTeachingLoadHours?: number;
  averageStudentFeedbackScore?: number;
  teachingAssignment?: TeachingAssignmentSummary;

  publicationsFirstOrCorrespondingAuthor?: number;
  publicationsQ1OrHighImpact?: number;
  sciScopusCount?: number;
  wosCount?: number;
  conferencePapersCount?: number;
  bookChaptersCount?: number;
  reviewPublicationsCount?: number;
  totalPublications?: number;
  totalCitations?: number;
  hIndex?: number;
  i10Index?: number;

  fundedProjects?: FundedProject[];
  consultancyProjects?: ConsultancyProject[];
  patents?: PatentSummary;

  phdScholarsPursuing?: { count?: number; universities?: string };
  phdScholarsAwarded?: { count?: number; universities?: string };
  nationalExposure?: string;
  internationalExposure?: string;
  labsEstablished?: LabEstablished[];
  administrativeResponsibilities?: string;
  certificationsAndFdps?: string;
  professionalBodyMemberships?: string;
  authoredBooks?: AuthoredBook[];
  notableAwards?: string;

  presentSalary?: number;
  grossAnnualCTC?: number;
  incrementsAwarded?: number;
  fundingConsultancyRevenue?: number;

  otherInformation?: string;
}

export interface ResumeData {
  name: string;
  role?: string;
  designation?: string;
  department?: string;
  employeeId?: string;
  email?: string;
  collegeEmail?: string;
  phone?: string;
  profilePhotoUrl?: string;
  collegeName?: string;

  joiningDate?: TimestampLike;
  employmentType?: string;
  status?: string;
  isActive?: boolean;
  hasPHD?: boolean;
  qualification?: string;
  specialization?: string;
  experienceYears?: number;
  internalExperience?: number;
  externalExperience?: number;
  inCampusExperience?: number;
  industryExperience?: number;
  researchExperience?: number;

  gender?: string;
  dateOfBirth?: TimestampLike;
  legalName?: string;
  fatherName?: string;
  motherName?: string;
  religion?: string;
  caste?: string;
  aadharNo?: string;
  panNo?: string;
  ratificationStatus?: string;
  ratificationDate?: TimestampLike;
  maritalStatus?: string;
  spouseName?: string;
  numberOfChildren?: number;
  referral?: string;
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string;
  bloodGroup?: string;

  academicProfile?: FacultyProfileFieldsLike;

  /** Live current teaching-assignment rows (course/section/subject), distinct from the
   *  Module 2 3-course summary — only populated for roles whose details page shows this
   *  (e.g. HOD's Faculty edit page). */
  teachingAssignments?: {
    courseName?: string;
    year?: number;
    sectionName?: string;
    subjectName?: string;
    subjectCode?: string;
    hoursPerWeek?: number;
  }[];
}

function esc(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Centered, ruled section heading, e.g. "EDUCATION" — always renders (rather than
 *  disappearing when a module is empty) so the document reads as complete even when
 *  a person's record hasn't had that module filled in yet. */
function sectionTitle(title: string): string {
  return `<div class="section-title">${esc(title)}</div>`;
}

/** Two-line entry header used by Education / Experience / Projects — bold title
 *  + right-aligned meta on the first line, plain subtitle + bold right-aligned
 *  meta (usually dates) on the second. Either line's right side may be omitted. */
function entry(title: string, titleRight: string, subtitle?: string, subtitleRight?: string): string {
  const t = esc(title);
  if (!t) return "";
  const row1 = `<div class="entry-row"><span class="l">${t}</span><span class="r">${esc(titleRight)}</span></div>`;
  const row2 = subtitle || subtitleRight
    ? `<div class="entry-sub"><span class="l">${esc(subtitle)}</span><span class="r">${esc(subtitleRight)}</span></div>`
    : "";
  return `<div class="entry">${row1}${row2}</div>`;
}

/** Hollow-bullet list of achievement/fact lines under an entry. Falsy items are
 *  dropped so a bullet never renders for a field the record doesn't have. */
function bullets(items: unknown[]): string {
  const rows = items.filter((i): i is string => typeof i === "string" && i.length > 0);
  if (!rows.length) return "";
  return `<ul class="bullets">${rows.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

/** A key/value cell in the compact personal/financial fact grid. Long free-text
 *  values pass wide=true to span the full grid width instead of a half column. */
function detail(label: string, value: unknown, wide = false): string {
  const v = esc(value);
  if (!v) return "";
  return `<div class="fitem${wide ? " fitem-wide" : ""}"><span class="fk">${esc(label)}</span><span class="fv">${v}</span></div>`;
}

function detailTable(rows: string): string {
  if (!rows.trim()) return "";
  return `<div class="fgrid">${rows}</div>`;
}

function emptyNote(): string {
  return `<p class="empty-note">No information on record for this section.</p>`;
}

function degreeEntry(label: string, d?: DegreeDetail): string {
  if (!d || (!d.degreeAndBranch && !d.universityOrInstitute)) return "";
  return entry(
    d.universityOrInstitute || label,
    d.yearOfCompletion ? String(d.yearOfCompletion) : "",
    `${label}${d.degreeAndBranch ? ` — ${d.degreeAndBranch}` : ""}`,
    d.percentageOrDivision || ""
  );
}

function addressFacts(data: ResumeData): string {
  const permanent = data.permanentSameAsTemporary ? data.temporaryAddress : data.permanentAddress;
  return detail("Temporary Address", data.temporaryAddress, true) + detail("Permanent Address", permanent, true);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function getResumeHTML(data: ResumeData): string {
  const ap = data.academicProfile;
  const roleLabel = data.role ? (ROLE_LABELS[data.role as keyof typeof ROLE_LABELS] ?? data.role) : "";
  const designationLabel = data.designation
    ? (DESIGNATION_LABELS[data.designation as keyof typeof DESIGNATION_LABELS] ?? data.designation)
    : "";
  const employmentTypeLabel = data.employmentType
    ? (EMPLOYMENT_TYPE_LABELS[data.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS] ?? data.employmentType)
    : "";
  const statusLabel = data.status
    ? (FACULTY_STATUS_LABELS[data.status as keyof typeof FACULTY_STATUS_LABELS] ?? data.status)
    : typeof data.isActive === "boolean"
    ? (data.isActive ? "Active" : "Inactive")
    : "";
  const subtitle = [designationLabel || roleLabel, data.department].filter(Boolean).join(" · ");

  // ── Header ───────────────────────────────────────────────────────────────
  const contactLines = [
    data.email ? `Email: ${esc(data.email)}` : "",
    data.collegeEmail ? `College Email: ${esc(data.collegeEmail)}` : "",
    data.phone ? `Mobile: ${esc(data.phone)}` : "",
    data.employeeId ? `Employee ID: ${esc(data.employeeId)}` : "",
  ].filter(Boolean);

  // ── Education ────────────────────────────────────────────────────────────
  const highestQualification = ap?.highestQualification || data.qualification;
  const educationEntries =
    degreeEntry("Ph.D.", ap?.phdDetails) +
    degreeEntry("Postgraduate", ap?.pgDetails) +
    degreeEntry("Undergraduate", ap?.ugDetails);
  const educationExtras = bullets([
    highestQualification && !ap?.phdDetails && !ap?.pgDetails && !ap?.ugDetails && `Highest Qualification: ${esc(highestQualification)}`,
    (ap?.phdStatus || ap?.phdMode) && `PhD Status: ${esc(ap?.phdStatus) || "—"} (${esc(ap?.phdMode) || "mode not recorded"})`,
    ap?.phdSupervisorName && `PhD Supervisor: ${esc(ap.phdSupervisorName)}`,
    ap?.fellowshipsReceived && `Fellowships Received: ${esc(ap.fellowshipsReceived)}`,
    ap?.gateQualifiedYear && `GATE Qualified: ${esc(ap.gateQualifiedYear)}${ap.gateScore ? ` (Score: ${esc(ap.gateScore)})` : ""}`,
    ap?.netSletQualificationYear && `NET / SLET Qualified: ${esc(ap.netSletQualificationYear)}`,
  ]);
  const educationBody = educationEntries + educationExtras;

  // ── Professional experience ─────────────────────────────────────────────
  const experienceEntry = entry(
    designationLabel || roleLabel || "Faculty",
    data.collegeName || "",
    data.department || "",
    data.joiningDate ? `${formatDate(data.joiningDate as Parameters<typeof formatDate>[0])} - ${data.isActive === false ? "Left" : "Present"}` : ""
  );
  const experienceBullets = bullets([
    (data.experienceYears || ap?.totalProfessionalExperienceYears) &&
      `Total Professional Experience: ${esc(data.experienceYears || ap?.totalProfessionalExperienceYears)} years`,
    (data.internalExperience || data.externalExperience) &&
      `Internal / External Experience: ${data.internalExperience ?? 0} yrs internal, ${data.externalExperience ?? 0} yrs external`,
    (data.inCampusExperience || data.industryExperience) &&
      `In-Campus / Industry Experience: ${data.inCampusExperience ?? 0} yrs in-campus, ${data.industryExperience ?? 0} yrs industry`,
    (data.researchExperience || ap?.researchOrIndustryExperienceYears) &&
      `Research / Industry Experience: ${esc(data.researchExperience || ap?.researchOrIndustryExperienceYears)} years`,
    (ap?.teachingExperienceBeforeJoiningYears || ap?.teachingExperienceSinceJoiningYears) &&
      `Teaching Experience: ${ap?.teachingExperienceBeforeJoiningYears ?? 0} yrs before joining, ${ap?.teachingExperienceSinceJoiningYears ?? 0} yrs since joining`,
    data.specialization && `Specialization: ${esc(data.specialization)}`,
    data.qualification && `Qualification: ${esc(data.qualification)}`,
  ]);
  const experienceBody = experienceEntry + experienceBullets;

  // ── Teaching load ────────────────────────────────────────────────────────
  const teachingLoadBullets = bullets([
    ap?.totalWeeklyTeachingLoadHours && `Weekly Teaching Load: ${esc(ap.totalWeeklyTeachingLoadHours)} hours`,
    ap?.averageStudentFeedbackScore && `Average Student Feedback Score: ${esc(ap.averageStudentFeedbackScore)}`,
    ap?.teachingAssignment?.primaryTeachingRole && `Primary Teaching Role: ${esc(ap.teachingAssignment.primaryTeachingRole)}`,
  ]);
  const teachingCourses = ap?.teachingAssignment?.courses?.length
    ? `<table class="data-table"><tr><th>Code</th><th>Course</th><th>Weekly Credit Hours</th></tr>${ap.teachingAssignment.courses
        .map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(c.weeklyCreditHours)}</td></tr>`)
        .join("")}</table>`
    : "";
  const currentTeachingAssignmentsTable = data.teachingAssignments?.length
    ? `<table class="data-table"><tr><th>Course</th><th>Year</th><th>Section</th><th>Subject</th><th>Hours/Week</th></tr>${data.teachingAssignments
        .map((t) => `<tr><td>${esc(t.courseName)}</td><td>${esc(t.year)}</td><td>${esc(t.sectionName)}</td><td>${esc(t.subjectName)}${t.subjectCode ? ` (${esc(t.subjectCode)})` : ""}</td><td>${esc(t.hoursPerWeek)}</td></tr>`)
        .join("")}</table>`
    : "";
  const teachingLoadBody = teachingLoadBullets + teachingCourses + currentTeachingAssignmentsTable;

  // ── Research publications ───────────────────────────────────────────────
  const publicationStatsBullets = bullets([
    ap?.totalPublications &&
      `Total Publications: ${esc(ap.totalPublications)}${ap.publicationsFirstOrCorrespondingAuthor ? ` (${esc(ap.publicationsFirstOrCorrespondingAuthor)} as first/corresponding author)` : ""}`,
    ap?.publicationsQ1OrHighImpact && `Q1 / High Impact Publications: ${esc(ap.publicationsQ1OrHighImpact)}`,
    (ap?.sciScopusCount || ap?.wosCount) &&
      `Indexing: SCI/Scopus ${ap?.sciScopusCount ?? 0} · Web of Science ${ap?.wosCount ?? 0}`,
    (ap?.conferencePapersCount || ap?.bookChaptersCount || ap?.reviewPublicationsCount) &&
      `Conference Papers: ${ap?.conferencePapersCount ?? 0} · Book Chapters: ${ap?.bookChaptersCount ?? 0} · Review Publications: ${ap?.reviewPublicationsCount ?? 0}`,
    (ap?.totalCitations || ap?.hIndex || ap?.i10Index) &&
      `Citations: ${ap?.totalCitations ?? 0} · h-Index: ${ap?.hIndex ?? 0} · i10-Index: ${ap?.i10Index ?? 0}`,
  ]);
  const booksEntries = ap?.authoredBooks?.length
    ? ap.authoredBooks.map((b) => entry(b.title || "Authored Book", b.year ? String(b.year) : "", b.publisher || "")).join("")
    : "";
  const publicationsBody = publicationStatsBullets + booksEntries;

  // ── Projects, grants & consultancy ──────────────────────────────────────
  const fundedProjectEntries = ap?.fundedProjects?.length
    ? ap.fundedProjects
        .map((p) =>
          entry(p.title || "Funded Project", p.year ? String(p.year) : "", p.fundingAgency || "", p.status || "") +
          bullets([p.grantAmountLakhs && `Grant Amount: ₹${esc(p.grantAmountLakhs)} Lakhs`])
        )
        .join("")
    : "";
  const consultancyEntries = ap?.consultancyProjects?.length
    ? ap.consultancyProjects
        .map((p) =>
          entry(p.title || "Consultancy Project", p.year ? String(p.year) : "", p.clientOrAgency || "", p.status || "") +
          bullets([p.revenueLakhs && `Revenue: ₹${esc(p.revenueLakhs)} Lakhs`])
        )
        .join("")
    : "";
  const labEntries = ap?.labsEstablished?.length
    ? ap.labsEstablished.map((l) => entry(l.facilityDetails || "Facility Established", "") + bullets([l.outcomes && `Outcomes: ${esc(l.outcomes)}`])).join("")
    : "";
  const patentsBullets = ap?.patents && (ap.patents.indianFiled || ap.patents.internationalFiled || ap.patents.details)
    ? bullets([
        (ap.patents.indianFiled || ap.patents.indianPublished || ap.patents.indianGranted) &&
          `Indian Patents (Filed / Published / Granted): ${ap.patents.indianFiled ?? 0} / ${ap.patents.indianPublished ?? 0} / ${ap.patents.indianGranted ?? 0}`,
        (ap.patents.internationalFiled || ap.patents.internationalPublished || ap.patents.internationalGranted) &&
          `International Patents (Filed / Published / Granted): ${ap.patents.internationalFiled ?? 0} / ${ap.patents.internationalPublished ?? 0} / ${ap.patents.internationalGranted ?? 0}`,
        ap.patents.details && `Patent Details: ${esc(ap.patents.details)}`,
      ])
    : "";
  const grantsBody = fundedProjectEntries + consultancyEntries + labEntries + patentsBullets;

  // ── Mentorship & institutional contribution ─────────────────────────────
  const mentorshipBody = bullets([
    ap?.phdScholarsPursuing?.count && `PhD Scholars Pursuing: ${esc(ap.phdScholarsPursuing.count)}${ap.phdScholarsPursuing.universities ? ` (${esc(ap.phdScholarsPursuing.universities)})` : ""}`,
    ap?.phdScholarsAwarded?.count && `PhD Scholars Awarded: ${esc(ap.phdScholarsAwarded.count)}${ap.phdScholarsAwarded.universities ? ` (${esc(ap.phdScholarsAwarded.universities)})` : ""}`,
    ap?.nationalExposure && `National Exposure: ${esc(ap.nationalExposure)}`,
    ap?.internationalExposure && `International Exposure: ${esc(ap.internationalExposure)}`,
    ap?.administrativeResponsibilities && `Administrative Responsibilities: ${esc(ap.administrativeResponsibilities)}`,
    ap?.notableAwards && `Notable Awards: ${esc(ap.notableAwards)}`,
  ]);

  // ── Certifications & memberships ────────────────────────────────────────
  const certificationsBody = bullets([
    ap?.certificationsAndFdps && esc(ap.certificationsAndFdps),
    ap?.professionalBodyMemberships && esc(ap.professionalBodyMemberships),
    data.ratificationStatus && `Ratification: ${esc(data.ratificationStatus)}${data.ratificationDate ? ` (${formatDate(data.ratificationDate as Parameters<typeof formatDate>[0])})` : ""}`,
  ]);

  // ── Personal & contact details ──────────────────────────────────────────
  const personalBody = detailTable(
    detail("Status", statusLabel) +
    detail("Employment Type", employmentTypeLabel) +
    detail("Date of Joining", data.joiningDate ? formatDate(data.joiningDate as Parameters<typeof formatDate>[0]) : "") +
    detail("Date of Birth", data.dateOfBirth ? formatDate(data.dateOfBirth as Parameters<typeof formatDate>[0]) : "") +
    detail("Gender", data.gender) +
    detail("Blood Group", data.bloodGroup) +
    detail("Marital Status", data.maritalStatus) +
    detail("Legal Name", data.legalName) +
    detail("Father / Husband", data.fatherName) +
    detail("Mother", data.motherName) +
    detail("Spouse", data.spouseName) +
    detail("Children", data.numberOfChildren) +
    detail("Religion", data.religion) +
    detail("Caste", data.caste) +
    detail("Native Place", data.nativePlace) +
    detail("Aadhar No.", data.aadharNo) +
    detail("PAN No.", data.panNo) +
    detail("Referral", data.referral) +
    addressFacts(data)
  );

  // ── Financial standing ──────────────────────────────────────────────────
  const financialBody = ap ? detailTable(
    detail("Present Salary", ap.presentSalary ? formatCurrency(ap.presentSalary) : "") +
    detail("Gross Annual CTC", ap.grossAnnualCTC ? formatCurrency(ap.grossAnnualCTC) : "") +
    detail("Increments Awarded", ap.incrementsAwarded ? formatCurrency(ap.incrementsAwarded) : "") +
    detail("Funding / Consultancy Revenue Offset", ap.fundingConsultancyRevenue ? formatCurrency(ap.fundingConsultancyRevenue) : "")
  ) : "";

  // ── Other information ────────────────────────────────────────────────────
  const otherInfoBody = ap?.otherInformation ? `<p class="summary-text">${esc(ap.otherInformation)}</p>` : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html { background: #ffffff; color-scheme: light only; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 12.5px; line-height: 1.45; color: #111827; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Free-flowing document — spans as many A4 pages as the content needs, with
     the top/bottom breathing room supplied per-page via page.pdf()'s margin. */
  .page { width: 210mm; background: #ffffff; padding: 0 15mm; }

  .resume-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 10px; }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .avatar { width: 66px; height: 66px; border-radius: 50%; object-fit: cover; border: 1.5px solid #111827; flex-shrink: 0; }
  .avatar-fallback { width: 66px; height: 66px; border-radius: 50%; background: #111827; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; flex-shrink: 0; }
  .name { font-size: 26px; font-weight: bold; color: #000000; }
  .subtitle { font-size: 13.5px; font-weight: 600; color: #1f2937; margin-top: 3px; }
  .college { font-size: 12px; color: #4b5563; margin-top: 2px; }
  .contact-block { text-align: right; font-size: 11.5px; line-height: 1.6; white-space: nowrap; }

  .section-title { text-align: center; font-weight: bold; font-size: 13px; letter-spacing: 0.6px; text-transform: uppercase; border-top: 1px solid #111827; border-bottom: 1px solid #111827; padding: 3px 0; margin: 14px 0 8px; break-after: avoid-page; }

  .entry { margin-bottom: 6px; break-inside: avoid-page; }
  .entry-row { display: flex; justify-content: space-between; gap: 10px; font-weight: bold; font-size: 12.5px; color: #000000; }
  .entry-row .r { white-space: nowrap; }
  .entry-sub { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; font-style: italic; color: #374151; }
  .entry-sub .r { font-weight: bold; font-style: normal; white-space: nowrap; }

  .bullets { margin: 2px 0 10px; padding: 0; list-style: none; }
  .bullets li { position: relative; padding-left: 14px; margin-bottom: 3px; font-size: 12px; break-inside: avoid-page; }
  .bullets li::before { content: "○"; position: absolute; left: 0; top: 1px; font-size: 8px; }

  .summary-text { font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; margin: 0 0 8px; }
  .empty-note { font-size: 12px; color: #6b7280; font-style: italic; margin: 3px 0 8px; }

  /* Compact 2-up key/value grid — used for personal/financial facts, which are
     simple label:value pairs rather than narrative achievements. */
  .fgrid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 18px; row-gap: 3px; margin: 3px 0 10px; }
  .fitem { font-size: 12px; padding: 2.5px 0; border-bottom: 1px dotted #d1d5db; break-inside: avoid-page; }
  .fitem-wide { grid-column: 1 / -1; }
  .fitem .fk { color: #4b5563; font-weight: 600; }
  .fitem .fk::after { content: ": "; }
  .fitem .fv { color: #111827; }

  table.data-table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; }
  table.data-table tr { break-inside: avoid-page; }
  table.data-table th { background: #e5e7eb; color: #111827; padding: 4px 8px; font-size: 11.5px; text-align: left; border: 1px solid #9ca3af; }
  table.data-table td { padding: 4px 8px; font-size: 11.5px; border: 1px solid #d1d5db; }

  .footer { margin-top: 10px; padding-top: 6px; border-top: 1px solid #d1d5db; font-size: 10px; color: #6b7280; text-align: center; }
</style>
</head>
<body>
<div class="page">
  <div class="resume-header">
    <div class="header-left">
      ${data.profilePhotoUrl
        ? `<img class="avatar" src="${esc(data.profilePhotoUrl)}" alt="">`
        : `<div class="avatar-fallback">${esc(initials(data.name))}</div>`}
      <div>
        <div class="name">${esc(data.name)}</div>
        ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ""}
        ${data.collegeName ? `<div class="college">${esc(data.collegeName)}</div>` : ""}
      </div>
    </div>
    <div class="contact-block">
      ${contactLines.map((l) => `<div>${l}</div>`).join("")}
    </div>
  </div>

  ${sectionTitle("Personal & Contact Details")}
  ${personalBody || emptyNote()}

  ${sectionTitle("Education")}
  ${educationBody || emptyNote()}

  ${sectionTitle("Teaching Load")}
  ${teachingLoadBody || emptyNote()}

  ${sectionTitle("Professional Experience")}
  ${experienceBody || emptyNote()}

  ${sectionTitle("Research Publications")}
  ${publicationsBody || emptyNote()}

  ${sectionTitle("Projects, Grants & Consultancy")}
  ${grantsBody || emptyNote()}

  ${sectionTitle("Mentorship & Institutional Contribution")}
  ${mentorshipBody || emptyNote()}

  ${sectionTitle("Certifications & Professional Memberships")}
  ${certificationsBody || emptyNote()}

  ${sectionTitle("Other Information")}
  ${otherInfoBody || emptyNote()}

  ${sectionTitle("Financial Standing & Budgetary Impact")}
  ${financialBody || emptyNote()}

  <div class="footer">Generated on ${esc(formatDate(new Date()))} — Confidential, for internal institutional use only.</div>
</div>
</body>
</html>`;
}
