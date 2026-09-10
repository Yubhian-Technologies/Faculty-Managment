"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { DesignationSelect } from "@/components/faculty/DesignationOptions";
import {
  SectionTitle, NumInput, TextInput, DateInput, MonthInput, DegreeFields, DegreeFieldsList, RepeatingGroup, QualificationsFields,
} from "@/components/shared/ProfileFieldPrimitives";
import { SCHOOL_TEACHING_QUALIFICATION_LEVELS } from "@/lib/designations/config";
import type {
  FacultyProfileFields,
  CollegeType,
  FundedProject,
  ConsultancyProject,
  LabEstablished,
  AuthoredBook,
  PreviousInstitution,
  PromotionRecord,
  TrainingEntry,
  TrainingEntryType,
  TrainingParticipationRole,
  TrainingProgramLevel,
  TrainingProgramMode,
  ProfessionalMembership,
  ProfessionalBody,
  AdminResponsibilityEntry,
  AdminResponsibilityCategory,
  AwardEntry,
  AwardCategory,
  AwardLevel,
} from "@/types";
import {
  TRAINING_ENTRY_TYPE_LABELS, TRAINING_PARTICIPATION_ROLE_LABELS, PROFESSIONAL_BODY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS, QUALIFYING_EXAM_LABELS,
  TRAINING_PROGRAM_LEVEL_LABELS, TRAINING_PROGRAM_MODE_LABELS, AWARD_LEVEL_LABELS,
} from "@/types";

// Inclusive day count between two "YYYY-MM-DD" dates (both days count, so a
// program running Mon-Fri is 5 days, not 4) - undefined until both ends are
// set and parse cleanly, rather than a stale/zero value.
function calcDurationDays(from: string | undefined, to: string | undefined): number | undefined {
  if (!from || !to) return undefined;
  const f = new Date(from).getTime();
  const t = new Date(to).getTime();
  if (Number.isNaN(f) || Number.isNaN(t) || t < f) return undefined;
  return Math.round((t - f) / 86400000) + 1;
}

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
const EMPTY_BOOK: AuthoredBook = { title: "", publisher: "", year: new Date().getFullYear() };
const EMPTY_PREVIOUS_INSTITUTION: PreviousInstitution = { institutionName: "", designation: "" };
const EMPTY_PROMOTION: PromotionRecord = { fromDesignation: "", toDesignation: "", effectiveYear: new Date().getFullYear() };
const EMPTY_TRAINING: TrainingEntry = { type: "FDP", title: "", organizer: "" };
const EMPTY_MEMBERSHIP: ProfessionalMembership = { body: "IEEE" };
const EMPTY_ADMIN_RESPONSIBILITY: AdminResponsibilityEntry = { category: "COORDINATOR", description: "" };
const EMPTY_AWARD: AwardEntry = { category: "BEST_TEACHER", title: "", awardingBody: "", year: new Date().getFullYear() };

export function AcademicProfileFields({ value, onChange, includeTeachingAssignment = true, hideFinancialModule = false, hideResearchModule = false, hidePromotionHistory = false, collegeType }: Props) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }

  const teaching = value.teachingAssignment;
  const patents = value.patents;
  const phdPursuing = value.phdScholarsPursuing;
  const phdAwarded = value.phdScholarsAwarded;
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
          title="Promotion History"
          items={value.promotionHistory}
          empty={EMPTY_PROMOTION}
          onChange={(v) => set("promotionHistory", v)}
          renderRow={(item, update) => (
            <>
              {/* Same catalogue-backed picker as the College Office promotion
                  page - this form writes the identical promotionHistory field,
                  so leaving it free-text here would let the two disagree. */}
              <DesignationSelect label="From Designation" value={item.fromDesignation} collegeType={collegeType} onChange={(v) => update({ fromDesignation: v })} />
              <DesignationSelect label="To Designation" value={item.toDesignation} collegeType={collegeType} onChange={(v) => update({ toDesignation: v })} />
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
          <SectionTitle>Module 3 - Research &amp; Development</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Individual publication records are maintained by the R&amp;D office - view them on the Research &amp; Development module.
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextInput label="Google Scholar ID" value={value.googleScholarId} onChange={(v) => set("googleScholarId", v)} />
            <TextInput label="Scopus Author ID" value={value.scopusAuthorId} onChange={(v) => set("scopusAuthorId", v)} />
            <TextInput label="ORCID iD" value={value.orcidId} onChange={(v) => set("orcidId", v)} />
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
            <div className="space-y-2">
              <Label>Participated or Conducted</Label>
              <Select value={item.role ?? ""} onValueChange={(v) => update({ role: v as TrainingParticipationRole })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TRAINING_PARTICIPATION_ROLE_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TextInput label="Title of the Program" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Name of the Faculty / Coordinator" value={item.organizer} onChange={(v) => update({ organizer: v })} />
            <DateInput
              label="From Date"
              value={item.fromDate}
              onChange={(v) => update({ fromDate: v, durationDays: calcDurationDays(v, item.toDate) })}
            />
            <DateInput
              label="To Date"
              value={item.toDate}
              onChange={(v) => update({ toDate: v, durationDays: calcDurationDays(item.fromDate, v) })}
              min={item.fromDate}
            />
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Duration</Label>
              <p className="text-sm font-medium pt-2">{item.durationDays ? `${item.durationDays} day${item.durationDays === 1 ? "" : "s"}` : "-"}</p>
            </div>
            <div className="space-y-2">
              <Label>National / International</Label>
              <Select value={item.levelOfProgram ?? ""} onValueChange={(v) => update({ levelOfProgram: v as TrainingProgramLevel })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TRAINING_PROGRAM_LEVEL_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TextInput label="Place" value={item.place} onChange={(v) => update({ place: v })} placeholder="e.g. Bhimavaram" />
            <div className="space-y-2">
              <Label>Mode of the Program</Label>
              <Select value={item.mode ?? ""} onValueChange={(v) => update({ mode: v as TrainingProgramMode })}>
                <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TRAINING_PROGRAM_MODE_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <NumInput label="Number of Participants" value={item.numberOfParticipants} onChange={(v) => update({ numberOfParticipants: v })} />
            <NumInput label="Number of Resource Persons" value={item.numberOfResourcePersons} onChange={(v) => update({ numberOfResourcePersons: v })} />
            <div className="sm:col-span-2">
              <TextInput
                label="Resource Persons - Details"
                value={item.resourcePersonsDetails}
                onChange={(v) => update({ resourcePersonsDetails: v })}
                placeholder="Names / affiliations of the resource persons"
              />
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
            <MonthInput label="Member Since (Month/Year)" value={item.sinceMonthYear} onChange={(v) => update({ sinceMonthYear: v })} />
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
