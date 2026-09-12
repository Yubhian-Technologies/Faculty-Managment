"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { DesignationSelect } from "@/components/faculty/DesignationOptions";
import { TrainingEntryFields } from "@/components/faculty/TrainingEntryFields";
import {
  SectionTitle, NumInput, TextInput, DateInput, DegreeFields, DegreeFieldsList, RepeatingGroup, QualificationsFields,
} from "@/components/shared/ProfileFieldPrimitives";
import { SCHOOL_TEACHING_QUALIFICATION_LEVELS } from "@/lib/designations/config";
import { durationBetween, formatDuration } from "@/lib/faculty/experienceCalc";
import type {
  FacultyProfileFields,
  CollegeType,
  FundedProject,
  ConsultancyProject,
  LabEstablished,
  PreviousInstitution,
  PromotionRecord,
  TrainingEntry,
  ProfessionalMembership,
  ProfessionalBody,
  MembershipValidity,
  AdminResponsibilityEntry,
  AdminResponsibilityCategory,
  AwardEntry,
  AwardCategory,
  AwardLevel,
} from "@/types";
import {
  PROFESSIONAL_BODY_LABELS, MEMBERSHIP_VALIDITY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS, QUALIFYING_EXAM_LABELS,
  AWARD_LEVEL_LABELS,
} from "@/types";

interface Props {
  value: Partial<FacultyProfileFields>;
  onChange: (next: Partial<FacultyProfileFields>) => void;
  includeTeachingAssignment?: boolean;
  hideFinancialModule?: boolean;
  hideResearchModule?: boolean;
  hidePromotionHistory?: boolean;
  collegeType?: CollegeType;
}

const EMPTY_FUNDED_PROJECT: FundedProject = { title: "", fundingAgency: "", grantAmountLakhs: 0, year: new Date().getFullYear(), status: "" };
const EMPTY_CONSULTANCY: ConsultancyProject = { title: "", clientOrAgency: "", revenueLakhs: 0, year: new Date().getFullYear(), status: "" };
const EMPTY_LAB: LabEstablished = { facilityDetails: "", outcomes: "" };
const EMPTY_PREVIOUS_INSTITUTION: PreviousInstitution = { institutionName: "", designation: "" };
const EMPTY_PROMOTION: PromotionRecord = { designation: "" };
const EMPTY_TRAINING: TrainingEntry = { type: "FDP", title: "", organizer: "" };
const EMPTY_MEMBERSHIP: ProfessionalMembership = { body: "IEEE" };
const EMPTY_ADMIN_RESPONSIBILITY: AdminResponsibilityEntry = { category: "COMMITTEE_MEMBER", description: "" };
const EMPTY_AWARD: AwardEntry = { category: "BEST_TEACHER", title: "", awardingBody: "", year: new Date().getFullYear() };

export function AcademicProfileFields({ value, onChange, includeTeachingAssignment = true, hideFinancialModule = false, hideResearchModule = false, hidePromotionHistory = false, collegeType }: Props) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }

  const teaching = value.teachingAssignment;
  const patents = value.patents;
  const isSchool = collegeType === "SCHOOL";

  return (
    <div className="space-y-5">
      {/* Module 1 */}
      <SectionTitle>Module 1 - General &amp; Academic Profile</SectionTitle>
      {isSchool ? (
        <>
          <TextInput label="Highest Qualification" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. B.Ed, M.A." />
          <QualificationsFields
            items={value.schoolQualifications}
            levelOptions={SCHOOL_TEACHING_QUALIFICATION_LEVELS}
            onChange={(v) => set("schoolQualifications", v)}
          />
        </>
      ) : (
        <>
          <TextInput label="Highest Qualification" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. Ph.D" />
          <div className="space-y-3 rounded-lg border p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>NET/SLET/SET/GATE/Others</Label>
                <Select value={value.qualifyingExamQualified ?? ""} onValueChange={(v) => set("qualifyingExamQualified", v as FacultyProfileFields["qualifyingExamQualified"])}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">Yes</SelectItem>
                    <SelectItem value="NO">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {value.qualifyingExamQualified === "YES" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Qualified Exam</Label>
                  <Select value={value.qualifyingExam ?? ""} onValueChange={(v) => set("qualifyingExam", v as FacultyProfileFields["qualifyingExam"])}>
                    <SelectTrigger><SelectValue placeholder="Select exam" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(QUALIFYING_EXAM_LABELS).map(([k, lbl]) => <SelectItem key={k} value={k}>{lbl}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {value.qualifyingExam === "OTHER" && (
                  <TextInput label="Please specify exam" value={value.otherQualifyingExam} onChange={(v) => set("otherQualifyingExam", v)} />
                )}
                <TextInput label="Score" value={value.qualifyingExamScore} onChange={(v) => set("qualifyingExamScore", v)} />
                <NumInput label="Qualified Year" value={value.qualifyingExamYear} onChange={(v) => set("qualifyingExamYear", v)} />
              </div>
            )}
          </div>
          <DegreeFields label="Secondary Education" level="HIGH_SCHOOL" value={value.highSchoolDetails} onChange={(v) => set("highSchoolDetails", v)} />
          <DegreeFields label="Intermediate (10+2) / Diploma (10+3) / ITI / Others" level="INTERMEDIATE" value={value.intermediateDetails} onChange={(v) => set("intermediateDetails", v)} />
          <DegreeFields label="UG Details" level="UG" value={value.ugDetails} onChange={(v) => set("ugDetails", v)} />
          <DegreeFieldsList label="UG Details" level="UG" items={value.additionalUgDetails} onChange={(v) => set("additionalUgDetails", v)} />
          <DegreeFields label="PG Details" level="PG" value={value.pgDetails} onChange={(v) => set("pgDetails", v)} />
          <DegreeFieldsList label="PG Details" level="PG" items={value.additionalPgDetails} onChange={(v) => set("additionalPgDetails", v)} />
          <DegreeFields
            label="Ph.D. Details"
            level="DOCTORAL"
            value={value.phdDetails}
            onChange={(v) => set("phdDetails", v)}
            status={value.phdStatus}
            extraFields={
              <>
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
              </>
            }
          />
          <DegreeFieldsList label="Ph.D. Details" level="DOCTORAL" items={value.additionalPhdDetails} onChange={(v) => set("additionalPhdDetails", v)} />
          <DegreeFields
            label="Postdoctoral Fellowship Details"
            level="POST_DOCTORAL"
            value={value.postDoctoralDetails}
            onChange={(v) => set("postDoctoralDetails", v)}
            status={value.postDoctoralStatus}
            extraFields={
              <>
                <div className="space-y-2">
                  <Label>Postdoctoral Status</Label>
                  <Select value={value.postDoctoralStatus ?? ""} onValueChange={(v) => set("postDoctoralStatus", v as FacultyProfileFields["postDoctoralStatus"])}>
                    <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AWARDED">Awarded</SelectItem>
                      <SelectItem value="PURSUING">Pursuing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Postdoctoral Mode</Label>
                  <Select value={value.postDoctoralMode ?? ""} onValueChange={(v) => set("postDoctoralMode", v as FacultyProfileFields["postDoctoralMode"])}>
                    <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL_TIME">Full-Time</SelectItem>
                      <SelectItem value="PART_TIME">Part-Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            }
          />
        </>
      )}

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
            {(() => {
              const fromDate = item.fromDate ?? (item.fromYear ? `${item.fromYear}-01-01` : undefined);
              return (
                <>
                  <DateInput label="From Date" value={fromDate} onChange={(v) => update({ fromDate: v })} />
                  <DateInput
                    label="To Date"
                    value={item.toDate ?? (item.toYear ? `${item.toYear}-01-01` : undefined)}
                    // min steers the native picker; the clamp below is the
                    // actual guarantee since a typed/pasted value can still
                    // bypass min - never let To Date land before From Date.
                    onChange={(v) => update({ toDate: fromDate && v && v < fromDate ? fromDate : v })}
                    min={fromDate}
                  />
                </>
              );
            })()}
            <NumInput label="Joining Salary" value={item.joiningSalary} onChange={(v) => update({ joiningSalary: v })} />
            <NumInput label="Leaving Salary" value={item.leavingSalary} onChange={(v) => update({ leavingSalary: v })} />
            <div className="sm:col-span-2 space-y-2">
              <Label>Reason for Leaving</Label>
              <Textarea value={item.reasonForLeaving ?? ""} onChange={(e) => update({ reasonForLeaving: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>NOC Obtained</Label>
              <Select value={item.nocObtained ?? ""} onValueChange={(v) => update({ nocObtained: v as PreviousInstitution["nocObtained"] })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="YES">Yes</SelectItem>
                  <SelectItem value="NO">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
      {!hidePromotionHistory && (
        <RepeatingGroup
          title="Teaching"
          items={value.promotionHistory}
          empty={EMPTY_PROMOTION}
          onChange={(v) => set("promotionHistory", v)}
          renderRow={(item, update) => {
            const today = new Date().toISOString().slice(0, 10);
            const duration = durationBetween(item.fromDate, item.toDate || today);
            return (
              <>
                {/* Same catalogue-backed picker as the College Office promotion
                    page - this form writes the identical promotionHistory field,
                    so leaving it free-text here would let the two disagree. */}
                <DesignationSelect label="Faculty Designation" value={item.designation} onChange={(v) => update({ designation: v })} />
                <DateInput label="From Date" value={item.fromDate} onChange={(v) => update({ fromDate: v })} />
                <DateInput
                  label="To Date (leave blank if currently serving)"
                  value={item.toDate}
                  onChange={(v) => update({ toDate: v })}
                  min={item.fromDate}
                />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Experience in this Designation</Label>
                  <p className="text-sm font-medium pt-2">{item.fromDate ? formatDuration(duration) : "-"}</p>
                </div>
                {item.fromDate && !item.toDate && (
                  <p className="sm:col-span-2 text-xs text-muted-foreground">
                    No To Date yet - experience is calculated up to today and will keep increasing until one is set.
                  </p>
                )}
                <div className="sm:col-span-2">
                  <Label className="text-xs">Promotion Order</Label>
                  <CertificateUploadField
                    value={item.orderUrl}
                    onUploaded={(url) => update({ orderUrl: url })}
                    onRemoved={() => update({ orderUrl: "" })}
                  />
                </div>
              </>
            );
          }}
        />
      )}

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
      {!hideResearchModule && (
        <>
          <SectionTitle>Module 3 - Research &amp; Innovation</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Individual publication records are maintained by the R&amp;D office - view them on the Research &amp; Innovation module.
            The fields below are self-reported summary metrics.
          </p>
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
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Research Profiles</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextInput label="ORCID iD" value={value.orcidId} onChange={(v) => set("orcidId", v)} />
            <TextInput label="Scopus Author ID" value={value.scopusAuthorId} onChange={(v) => set("scopusAuthorId", v)} />
            <TextInput label="Researcher ID" value={value.researcherId} onChange={(v) => set("researcherId", v)} />
            <TextInput label="Google Scholar ID" value={value.googleScholarId} onChange={(v) => set("googleScholarId", v)} />
            <TextInput label="IRINS Profile" value={value.irinsProfile} onChange={(v) => set("irinsProfile", v)} />
          </div>
        </>
      )}

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
        title="Consultancy Projects"
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
      <SectionTitle>Module 5 - Professional Development</SectionTitle>
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
        title="Academic Responsibilities"
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
            {item.category === "OTHER" && (
              <TextInput label="Category" value={item.otherCategory} onChange={(v) => update({ otherCategory: v })} />
            )}
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
        empty={() => ({ ...EMPTY_TRAINING, id: crypto.randomUUID() })}
        onChange={(v) => set("trainingEntries", v)}
        renderRow={(item, update) => (
          // No facultyId/owner name yet - this record doesn't exist until the
          // wizard is submitted, so co-conductor sync can't apply here (see
          // syncTrainingEntryCoConductors); it starts working once this entry
          // is next edited via the Mentorship module edit page.
          <TrainingEntryFields item={item} update={update} />
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
            <TextInput
              label="Membership Type"
              value={item.membershipType}
              onChange={(v) => update({ membershipType: v })}
              placeholder="e.g. Senior Fellowship / Associate Fellowship / Fellowship"
            />
            <TextInput label="Membership ID" value={item.membershipId} onChange={(v) => update({ membershipId: v })} />
            <div className="space-y-2">
              <Label>Membership Validity</Label>
              <Select value={item.validity ?? ""} onValueChange={(v) => update({ validity: v as MembershipValidity })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(MEMBERSHIP_VALIDITY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {item.validity === "LIFETIME" && (
              <DateInput label="Member Since" value={item.sinceDate} onChange={(v) => update({ sinceDate: v })} />
            )}
            {item.validity === "ANNUAL" && (
              <>
                <DateInput label="Valid From" value={item.validFrom} onChange={(v) => update({ validFrom: v })} />
                <DateInput label="Valid To" value={item.validTo} onChange={(v) => update({ validTo: v })} min={item.validFrom} />
              </>
            )}
          </>
        )}
      />
      {value.professionalBodyMemberships && (
        <p className="text-xs text-muted-foreground italic">Legacy note: {value.professionalBodyMemberships}</p>
      )}
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
            {item.category === "OTHER" && (
              <TextInput label="Please specify category" value={item.otherCategory} onChange={(v) => update({ otherCategory: v })} />
            )}
            <TextInput label="Title of Awarded" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Awarding Agency/Body" value={item.awardingBody} onChange={(v) => update({ awardingBody: v })} />
            <DateInput
              label="Date of Awarded"
              value={item.dateAwarded}
              onChange={(v) => update({ dateAwarded: v, year: v ? new Date(v).getFullYear() : item.year })}
            />
            <div className="space-y-2">
              <Label>State / National / International</Label>
              <Select value={item.level ?? ""} onValueChange={(v) => update({ level: v as AwardLevel })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(AWARD_LEVEL_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Other Details (if any)</Label>
              <Textarea value={item.otherDetails ?? ""} onChange={(e) => update({ otherDetails: e.target.value })} />
            </div>
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
    </div>
  );
}
