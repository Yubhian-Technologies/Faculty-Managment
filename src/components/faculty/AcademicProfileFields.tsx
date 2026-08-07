"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import {
  SectionTitle, NumInput, TextInput, DegreeFields, RepeatingGroup,
} from "@/components/shared/ProfileFieldPrimitives";
import type {
  FacultyProfileFields,
  Publication,
  FundedProject,
  ConsultancyProject,
  LabEstablished,
  AuthoredBook,
  PreviousInstitution,
  PromotionRecord,
  TrainingEntry,
  TrainingEntryType,
  ProfessionalMembership,
  ProfessionalBody,
  AdminResponsibilityEntry,
  AdminResponsibilityCategory,
  AwardEntry,
  AwardCategory,
  CourseFileEntry,
} from "@/types";
import {
  TRAINING_ENTRY_TYPE_LABELS, PROFESSIONAL_BODY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS,
} from "@/types";

interface Props {
  value: Partial<FacultyProfileFields>;
  onChange: (next: Partial<FacultyProfileFields>) => void;
  includeTeachingAssignment?: boolean;
  hideFinancialModule?: boolean;
}

const EMPTY_PUBLICATION: Publication = { title: "", coAuthors: "", journalOrConference: "", publicationYear: new Date().getFullYear(), indexing: "", driveLink: "" };
const EMPTY_FUNDED_PROJECT: FundedProject = { title: "", fundingAgency: "", grantAmountLakhs: 0, year: new Date().getFullYear(), status: "" };
const EMPTY_CONSULTANCY: ConsultancyProject = { title: "", clientOrAgency: "", revenueLakhs: 0, year: new Date().getFullYear(), status: "" };
const EMPTY_LAB: LabEstablished = { facilityDetails: "", outcomes: "" };
const EMPTY_BOOK: AuthoredBook = { title: "", publisher: "", year: new Date().getFullYear() };
const EMPTY_PREVIOUS_INSTITUTION: PreviousInstitution = { institutionName: "", designation: "", yearsWorked: 0 };
const EMPTY_PROMOTION: PromotionRecord = { fromDesignation: "", toDesignation: "", effectiveYear: new Date().getFullYear() };
const EMPTY_TRAINING: TrainingEntry = { type: "FDP", title: "", organizer: "", year: new Date().getFullYear() };
const EMPTY_MEMBERSHIP: ProfessionalMembership = { body: "IEEE" };
const EMPTY_ADMIN_RESPONSIBILITY: AdminResponsibilityEntry = { category: "COORDINATOR", description: "" };
const EMPTY_AWARD: AwardEntry = { category: "BEST_TEACHER", title: "", awardingBody: "", year: new Date().getFullYear() };
const EMPTY_COURSE_FILE: CourseFileEntry = { courseCode: "", courseName: "", academicYear: "" };

export function AcademicProfileFields({ value, onChange, includeTeachingAssignment = true, hideFinancialModule = false }: Props) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }

  const teaching = value.teachingAssignment;
  const patents = value.patents;
  const phdPursuing = value.phdScholarsPursuing;
  const phdAwarded = value.phdScholarsAwarded;

  return (
    <div className="space-y-5">
      {/* Module 1 */}
      <SectionTitle>Module 1 - General &amp; Academic Profile</SectionTitle>
      <TextInput label="Highest Qualification Earned" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. Ph.D" />
      <DegreeFields label="UG Details" value={value.ugDetails} onChange={(v) => set("ugDetails", v)} />
      <DegreeFields label="PG Details" value={value.pgDetails} onChange={(v) => set("pgDetails", v)} />
      <DegreeFields label="PhD Details" value={value.phdDetails} onChange={(v) => set("phdDetails", v)} />
      <DegreeFields label="Post-Doctoral Details" value={value.postDoctoralDetails} onChange={(v) => set("postDoctoralDetails", v)} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Ph.D. Status</Label>
          <Select value={value.phdStatus ?? ""} onValueChange={(v) => set("phdStatus", v as FacultyProfileFields["phdStatus"])}>
            <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AWARDED">Awarded</SelectItem>
              <SelectItem value="PURSUING">Pursuing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Ph.D. Mode</Label>
          <Select value={value.phdMode ?? ""} onValueChange={(v) => set("phdMode", v as FacultyProfileFields["phdMode"])}>
            <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FULL_TIME">Full-Time</SelectItem>
              <SelectItem value="PART_TIME">Part-Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Project Supervisor Name" value={value.phdSupervisorName} onChange={(v) => set("phdSupervisorName", v)} />
        <TextInput label="Fellowships Received" value={value.fellowshipsReceived} onChange={(v) => set("fellowshipsReceived", v)} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NumInput label="GATE Qualified Year" value={value.gateQualifiedYear} onChange={(v) => set("gateQualifiedYear", v)} />
        <NumInput label="GATE Score" value={value.gateScore} onChange={(v) => set("gateScore", v)} />
        <NumInput label="NET/SLET Qualification Year" value={value.netSletQualificationYear} onChange={(v) => set("netSletQualificationYear", v)} />
      </div>

      <SectionTitle>Module 2 - Previous Experience</SectionTitle>
      <RepeatingGroup
        title="Previous Experience"
        items={value.previousInstitutions}
        empty={EMPTY_PREVIOUS_INSTITUTION}
        onChange={(v) => set("previousInstitutions", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Institution Name" value={item.institutionName} onChange={(v) => update({ institutionName: v })} />
            <TextInput label="Designation" value={item.designation} onChange={(v) => update({ designation: v })} />
            <NumInput label="Years Worked" value={item.yearsWorked} onChange={(v) => update({ yearsWorked: v })} />
            <div className="sm:col-span-2">
              <Label className="text-xs">Experience Certificate</Label>
              <CertificateUploadField
                value={item.experienceCertificateUrl}
                onUploaded={(url) => update({ experienceCertificateUrl: url })}
                onRemoved={() => update({ experienceCertificateUrl: "" })}
              />
            </div>
          </>
        )}
      />
      <RepeatingGroup
        title="Promotion History"
        items={value.promotionHistory}
        empty={EMPTY_PROMOTION}
        onChange={(v) => set("promotionHistory", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="From Designation" value={item.fromDesignation} onChange={(v) => update({ fromDesignation: v })} />
            <TextInput label="To Designation" value={item.toDesignation} onChange={(v) => update({ toDesignation: v })} />
            <NumInput label="Effective Year" value={item.effectiveYear} onChange={(v) => update({ effectiveYear: v })} />
            <div className="sm:col-span-2">
              <Label className="text-xs">Promotion Order</Label>
              <CertificateUploadField
                value={item.orderUrl}
                onUploaded={(url) => update({ orderUrl: url })}
                onRemoved={() => update({ orderUrl: "" })}
              />
            </div>
          </>
        )}
      />

      {includeTeachingAssignment && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Teaching Role</p>
          <TextInput
            label="Primary Teaching Role / Specialization"
            value={teaching?.primaryTeachingRole}
            onChange={(v) => set("teachingAssignment", { primaryTeachingRole: v, courses: teaching?.courses ?? [] })}
          />
          <p className="text-xs text-muted-foreground">
            Subject-level teaching assignments (course, section, subject, weekly schedule) are managed below in &ldquo;Current Teaching Assignments&rdquo;.
          </p>
        </div>
      )}

      {/* Module 3 */}
      <SectionTitle>Module 3 - Research Publications</SectionTitle>
      <RepeatingGroup
        title="Publications"
        items={value.publications}
        empty={EMPTY_PUBLICATION}
        onChange={(v) => set("publications", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Co-Authors" value={item.coAuthors} onChange={(v) => update({ coAuthors: v })} placeholder="Comma-separated names" />
            <TextInput label="Journal / Conference" value={item.journalOrConference} onChange={(v) => update({ journalOrConference: v })} />
            <NumInput label="Year of Publication" value={item.publicationYear} onChange={(v) => update({ publicationYear: v })} />
            <TextInput label="Indexing" value={item.indexing} onChange={(v) => update({ indexing: v })} placeholder="e.g. SCI, Scopus, WoS, UGC-CARE" />
            <div className="sm:col-span-2">
              <TextInput label="Publication Link" value={item.driveLink} onChange={(v) => update({ driveLink: v })} placeholder="Paste your Google Drive public view link" />
            </div>
          </>
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NumInput label="First/Corresponding Author Pubs" value={value.publicationsFirstOrCorrespondingAuthor} onChange={(v) => set("publicationsFirstOrCorrespondingAuthor", v)} />
        <NumInput label="Q1 / IF > 4.0 Pubs" value={value.publicationsQ1OrHighImpact} onChange={(v) => set("publicationsQ1OrHighImpact", v)} />
        <NumInput label="SCI/Scopus Count" value={value.sciScopusCount} onChange={(v) => set("sciScopusCount", v)} />
        <NumInput label="WoS (SCIE/ESCI) Count" value={value.wosCount} onChange={(v) => set("wosCount", v)} />
        <NumInput label="Conference Papers" value={value.conferencePapersCount} onChange={(v) => set("conferencePapersCount", v)} />
        <NumInput label="Book Chapters" value={value.bookChaptersCount} onChange={(v) => set("bookChaptersCount", v)} />
        <NumInput label="Review Publications" value={value.reviewPublicationsCount} onChange={(v) => set("reviewPublicationsCount", v)} />
        <NumInput label="Total Publications" value={value.totalPublications} onChange={(v) => set("totalPublications", v)} />
        <NumInput label="Total Citations" value={value.totalCitations} onChange={(v) => set("totalCitations", v)} />
        <NumInput label="H-Index" value={value.hIndex} onChange={(v) => set("hIndex", v)} />
        <NumInput label="i10-Index" value={value.i10Index} onChange={(v) => set("i10Index", v)} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextInput label="Google Scholar ID" value={value.googleScholarId} onChange={(v) => set("googleScholarId", v)} />
        <TextInput label="Scopus Author ID" value={value.scopusAuthorId} onChange={(v) => set("scopusAuthorId", v)} />
        <TextInput label="ORCID iD" value={value.orcidId} onChange={(v) => set("orcidId", v)} />
      </div>

      {/* Module 4 */}
      <SectionTitle>Module 4 - Grants, Consultancy &amp; IP</SectionTitle>
      <RepeatingGroup
        title="Funded Projects"
        items={value.fundedProjects}
        empty={EMPTY_FUNDED_PROJECT}
        onChange={(v) => set("fundedProjects", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Funding Agency" value={item.fundingAgency} onChange={(v) => update({ fundingAgency: v })} />
            <NumInput label="Grant Amount (₹L)" value={item.grantAmountLakhs} onChange={(v) => update({ grantAmountLakhs: v })} />
            <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
            <TextInput label="Status" value={item.status} onChange={(v) => update({ status: v })} />
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={item.piOrCoPi ?? ""} onValueChange={(v) => update({ piOrCoPi: v as FundedProject["piOrCoPi"] })}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PI">PI</SelectItem>
                  <SelectItem value="CO_PI">Co-PI</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      />
      <RepeatingGroup
        title="Industry Consultancy"
        items={value.consultancyProjects}
        empty={EMPTY_CONSULTANCY}
        onChange={(v) => set("consultancyProjects", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Client / Agency" value={item.clientOrAgency} onChange={(v) => update({ clientOrAgency: v })} />
            <NumInput label="Revenue (₹L)" value={item.revenueLakhs} onChange={(v) => update({ revenueLakhs: v })} />
            <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
            <TextInput label="Status" value={item.status} onChange={(v) => update({ status: v })} />
          </>
        )}
      />
      <div className="space-y-3 rounded-lg border p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Patents</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumInput label="Indian - Filed" value={patents?.indianFiled} onChange={(v) => set("patents", { ...patents, indianFiled: v } as FacultyProfileFields["patents"])} />
          <NumInput label="Indian - Published" value={patents?.indianPublished} onChange={(v) => set("patents", { ...patents, indianPublished: v } as FacultyProfileFields["patents"])} />
          <NumInput label="Indian - Granted" value={patents?.indianGranted} onChange={(v) => set("patents", { ...patents, indianGranted: v } as FacultyProfileFields["patents"])} />
          <NumInput label="International - Filed" value={patents?.internationalFiled} onChange={(v) => set("patents", { ...patents, internationalFiled: v } as FacultyProfileFields["patents"])} />
          <NumInput label="International - Published" value={patents?.internationalPublished} onChange={(v) => set("patents", { ...patents, internationalPublished: v } as FacultyProfileFields["patents"])} />
          <NumInput label="International - Granted" value={patents?.internationalGranted} onChange={(v) => set("patents", { ...patents, internationalGranted: v } as FacultyProfileFields["patents"])} />
        </div>
        <div className="space-y-2">
          <Label>Details</Label>
          <Textarea value={patents?.details ?? ""} onChange={(e) => set("patents", { ...patents, details: e.target.value } as FacultyProfileFields["patents"])} />
        </div>
      </div>

      {/* Module 5 */}
      <SectionTitle>Module 5 - Mentorship &amp; Institutional Value</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ph.D. Scholars Pursuing</p>
          <NumInput label="Count" value={phdPursuing?.count} onChange={(v) => set("phdScholarsPursuing", { count: v, universities: phdPursuing?.universities ?? "" })} />
          <TextInput label="University Names" value={phdPursuing?.universities} onChange={(v) => set("phdScholarsPursuing", { count: phdPursuing?.count ?? 0, universities: v })} />
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ph.D. Scholars Awarded</p>
          <NumInput label="Count" value={phdAwarded?.count} onChange={(v) => set("phdScholarsAwarded", { count: v, universities: phdAwarded?.universities ?? "" })} />
          <TextInput label="University Names" value={phdAwarded?.universities} onChange={(v) => set("phdScholarsAwarded", { count: phdAwarded?.count ?? 0, universities: v })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>National Exposure (joint pubs w/ IITs/NITs/IIITs/CSIR)</Label>
        <Textarea value={value.nationalExposure ?? ""} onChange={(e) => set("nationalExposure", e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>International Exposure (joint pubs w/ foreign universities)</Label>
        <Textarea value={value.internationalExposure ?? ""} onChange={(e) => set("internationalExposure", e.target.value)} />
      </div>
      <RepeatingGroup
        title="New Labs Established"
        items={value.labsEstablished}
        empty={EMPTY_LAB}
        onChange={(v) => set("labsEstablished", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Facility Details" value={item.facilityDetails} onChange={(v) => update({ facilityDetails: v })} />
            <TextInput label="Outcomes" value={item.outcomes} onChange={(v) => update({ outcomes: v })} />
          </>
        )}
      />
      <RepeatingGroup
        title="Administrative Responsibilities"
        items={value.adminResponsibilityEntries}
        empty={EMPTY_ADMIN_RESPONSIBILITY}
        onChange={(v) => set("adminResponsibilityEntries", v)}
        renderRow={(item, update) => (
          <>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={item.category} onValueChange={(v) => update({ category: v as AdminResponsibilityCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ADMIN_RESPONSIBILITY_CATEGORY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TextInput label="Description" value={item.description} onChange={(v) => update({ description: v })} />
            <NumInput label="From Year" value={item.fromYear} onChange={(v) => update({ fromYear: v })} />
            <NumInput label="To Year (blank = ongoing)" value={item.toYear} onChange={(v) => update({ toYear: v })} />
          </>
        )}
      />
      {value.administrativeResponsibilities && (
        <p className="text-xs text-muted-foreground italic">Legacy note: {value.administrativeResponsibilities}</p>
      )}
      <RepeatingGroup
        title="FDPs, Workshops, MOOCs & Certifications"
        items={value.trainingEntries}
        empty={EMPTY_TRAINING}
        onChange={(v) => set("trainingEntries", v)}
        renderRow={(item, update) => (
          <>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={item.type} onValueChange={(v) => update({ type: v as TrainingEntryType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TRAINING_ENTRY_TYPE_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Organizer" value={item.organizer} onChange={(v) => update({ organizer: v })} />
            <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
            <NumInput label="Duration (days)" value={item.durationDays} onChange={(v) => update({ durationDays: v })} />
            <div className="sm:col-span-2">
              <Label className="text-xs">Certificate</Label>
              <CertificateUploadField
                value={item.certificateUrl}
                onUploaded={(url) => update({ certificateUrl: url })}
                onRemoved={() => update({ certificateUrl: "" })}
              />
            </div>
          </>
        )}
      />
      {value.certificationsAndFdps && (
        <p className="text-xs text-muted-foreground italic">Legacy note: {value.certificationsAndFdps}</p>
      )}
      <RepeatingGroup
        title="Professional Body Memberships"
        items={value.professionalMemberships}
        empty={EMPTY_MEMBERSHIP}
        onChange={(v) => set("professionalMemberships", v)}
        renderRow={(item, update) => (
          <>
            <div className="space-y-2">
              <Label>Body</Label>
              <Select value={item.body} onValueChange={(v) => update({ body: v as ProfessionalBody })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROFESSIONAL_BODY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {item.body === "OTHER" && (
              <TextInput label="Body Name" value={item.otherName} onChange={(v) => update({ otherName: v })} />
            )}
            <TextInput label="Membership ID" value={item.membershipId} onChange={(v) => update({ membershipId: v })} />
            <NumInput label="Member Since (Year)" value={item.sinceYear} onChange={(v) => update({ sinceYear: v })} />
          </>
        )}
      />
      {value.professionalBodyMemberships && (
        <p className="text-xs text-muted-foreground italic">Legacy note: {value.professionalBodyMemberships}</p>
      )}
      <RepeatingGroup
        title="Authored Books"
        items={value.authoredBooks}
        empty={EMPTY_BOOK}
        onChange={(v) => set("authoredBooks", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Publisher" value={item.publisher} onChange={(v) => update({ publisher: v })} />
            <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
          </>
        )}
      />
      <RepeatingGroup
        title="Awards & Recognition"
        items={value.awardEntries}
        empty={EMPTY_AWARD}
        onChange={(v) => set("awardEntries", v)}
        renderRow={(item, update) => (
          <>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={item.category} onValueChange={(v) => update({ category: v as AwardCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(AWARD_CATEGORY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Awarding Body" value={item.awardingBody} onChange={(v) => update({ awardingBody: v })} />
            <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
            <div className="sm:col-span-2">
              <Label className="text-xs">Certificate</Label>
              <CertificateUploadField
                value={item.certificateUrl}
                onUploaded={(url) => update({ certificateUrl: url })}
                onRemoved={() => update({ certificateUrl: "" })}
              />
            </div>
          </>
        )}
      />
      {value.notableAwards && (
        <p className="text-xs text-muted-foreground italic">Legacy note: {value.notableAwards}</p>
      )}

      {/* Module 6 */}
      {!hideFinancialModule && (
        <>
          <SectionTitle>Module 6 - Financial Standing &amp; Budgetary Impact</SectionTitle>
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Financial Standing</p>
            <NumInput label="Present Salary (₹)" value={value.presentSalary} onChange={(v) => set("presentSalary", v)} />
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Budgetary Impact</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <NumInput label="Gross Annual CTC (₹)" value={value.grossAnnualCTC} onChange={(v) => set("grossAnnualCTC", v)} />
              <NumInput label="Increments Awarded" value={value.incrementsAwarded} onChange={(v) => set("incrementsAwarded", v)} />
              <NumInput label="Funding/Consultancy Revenue Generation (₹)" value={value.fundingConsultancyRevenue} onChange={(v) => set("fundingConsultancyRevenue", v)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Revenue brought in through research/consultancy grants, offsetting this faculty member&rsquo;s salary cost to the institution.
            </p>
          </div>
        </>
      )}

      {/* Module 7 */}
      <SectionTitle>Module 7 - Others</SectionTitle>
      <div className="space-y-2">
        <Label>Other Information</Label>
        <Textarea
          value={value.otherInformation ?? ""}
          onChange={(e) => set("otherInformation", e.target.value)}
          placeholder="Anything not covered above - add it here"
          rows={4}
        />
      </div>

      {/* Module 8 */}
      <SectionTitle>Module 8 - Teaching Documentation (NBA/AICTE)</SectionTitle>
      <RepeatingGroup
        title="Course Files & CO-PO Mapping"
        items={value.courseFilesAndCoPoMapping}
        empty={EMPTY_COURSE_FILE}
        onChange={(v) => set("courseFilesAndCoPoMapping", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Course Code" value={item.courseCode} onChange={(v) => update({ courseCode: v })} />
            <TextInput label="Course Name" value={item.courseName} onChange={(v) => update({ courseName: v })} />
            <TextInput label="Academic Year" value={item.academicYear} onChange={(v) => update({ academicYear: v })} placeholder="e.g. 2025-26" />
            <div className="space-y-1">
              <Label className="text-xs">Course File</Label>
              <CertificateUploadField
                value={item.courseFileUrl}
                onUploaded={(url) => update({ courseFileUrl: url })}
                onRemoved={() => update({ courseFileUrl: "" })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CO-PO Mapping</Label>
              <CertificateUploadField
                value={item.coPoMappingUrl}
                onUploaded={(url) => update({ coPoMappingUrl: url })}
                onRemoved={() => update({ coPoMappingUrl: "" })}
              />
            </div>
          </>
        )}
      />
    </div>
  );
}
