"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { DesignationSelect } from "@/components/faculty/DesignationOptions";
import {
  NumInput, TextInput, DegreeFields, RepeatingGroup, QualificationsFields,
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
  ProfessionalMembership,
  ProfessionalBody,
  AdminResponsibilityEntry,
  AdminResponsibilityCategory,
  AwardEntry,
  AwardCategory,
} from "@/types";
import {
  TRAINING_ENTRY_TYPE_LABELS, TRAINING_PARTICIPATION_ROLE_LABELS, PROFESSIONAL_BODY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS,
} from "@/types";

// Edit-side per-module field components - the editable counterpart to
// ProfileFieldsView.tsx's per-module read-only exports. Each takes the same
// full Partial<FacultyProfileFields> + onChange (merged client-side, same as
// the old single-form AcademicProfileFields used to) so a module edit page
// can fetch the whole academicProfile once, hand it to exactly one of these,
// and PATCH the whole (slice-updated) object back - see
// FacultyProfileModuleEditor.tsx for the round-trip that makes this safe
// against the PATCH routes' wholesale-replace behavior.

export interface ModuleFieldsProps {
  value: Partial<FacultyProfileFields>;
  onChange: (next: Partial<FacultyProfileFields>) => void;
}

const EMPTY_FUNDED_PROJECT: FundedProject = { title: "", fundingAgency: "", grantAmountLakhs: 0, year: new Date().getFullYear(), status: "" };
const EMPTY_CONSULTANCY: ConsultancyProject = { title: "", clientOrAgency: "", revenueLakhs: 0, year: new Date().getFullYear(), status: "" };
const EMPTY_LAB: LabEstablished = { facilityDetails: "", outcomes: "" };
const EMPTY_BOOK: AuthoredBook = { title: "", publisher: "", year: new Date().getFullYear() };
const EMPTY_PREVIOUS_INSTITUTION: PreviousInstitution = { institutionName: "", designation: "", fromYear: new Date().getFullYear(), toYear: new Date().getFullYear() };
const EMPTY_PROMOTION: PromotionRecord = { fromDesignation: "", toDesignation: "", effectiveYear: new Date().getFullYear() };
const EMPTY_TRAINING: TrainingEntry = { type: "FDP", title: "", organizer: "", year: new Date().getFullYear() };
const EMPTY_MEMBERSHIP: ProfessionalMembership = { body: "IEEE" };
const EMPTY_ADMIN_RESPONSIBILITY: AdminResponsibilityEntry = { category: "COORDINATOR", description: "" };
const EMPTY_AWARD: AwardEntry = { category: "BEST_TEACHER", title: "", awardingBody: "", year: new Date().getFullYear() };

export function QualificationFields({ value, onChange, collegeType }: ModuleFieldsProps & { collegeType?: CollegeType }) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }

  if (collegeType === "SCHOOL") {
    return (
      <div className="space-y-5">
        <TextInput label="Highest Qualification Earned" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. B.Ed, M.A." />
        <QualificationsFields
          items={value.schoolQualifications}
          levelOptions={SCHOOL_TEACHING_QUALIFICATION_LEVELS}
          onChange={(v) => set("schoolQualifications", v)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <TextInput label="Highest Qualification Earned" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. Ph.D" />
      <DegreeFields label="High School (10th) Details" level="HIGH_SCHOOL" value={value.highSchoolDetails} onChange={(v) => set("highSchoolDetails", v)} />
      <DegreeFields label="Intermediate (12th) Details" level="INTERMEDIATE" value={value.intermediateDetails} onChange={(v) => set("intermediateDetails", v)} />
      <DegreeFields label="UG Details" level="UG" value={value.ugDetails} onChange={(v) => set("ugDetails", v)} />
      <DegreeFields label="PG Details" level="PG" value={value.pgDetails} onChange={(v) => set("pgDetails", v)} />
      <DegreeFields label="PhD Details" level="DOCTORAL" value={value.phdDetails} onChange={(v) => set("phdDetails", v)} />
      <DegreeFields label="Post-Doctoral Details" level="POST_DOCTORAL" value={value.postDoctoralDetails} onChange={(v) => set("postDoctoralDetails", v)} />
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
    </div>
  );
}

export function ExperienceFields({ value, onChange, includeTeachingAssignment = true }: ModuleFieldsProps & { includeTeachingAssignment?: boolean }) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  const teaching = value.teachingAssignment;
  return (
    <div className="space-y-5">
      <RepeatingGroup
        title="Previous Experience"
        items={value.previousInstitutions}
        empty={EMPTY_PREVIOUS_INSTITUTION}
        onChange={(v) => set("previousInstitutions", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Institution Name" value={item.institutionName} onChange={(v) => update({ institutionName: v })} />
            <TextInput label="Designation" value={item.designation} onChange={(v) => update({ designation: v })} />
            <NumInput label="From Year" value={item.fromYear} onChange={(v) => update({ fromYear: v })} />
            <NumInput label="To Year" value={item.toYear} onChange={(v) => update({ toYear: v })} />
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
      <p className="text-xs text-muted-foreground rounded-md border bg-muted/20 p-2">
        Promotion History is maintained by the College Office - it can no longer be edited here.
      </p>
      {includeTeachingAssignment && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Teaching Role</p>
          <TextInput
            label="Primary Teaching Role / Specialization"
            value={teaching?.primaryTeachingRole}
            onChange={(v) => set("teachingAssignment", { primaryTeachingRole: v, courses: teaching?.courses ?? [] })}
          />
          <p className="text-xs text-muted-foreground">
            Subject-level teaching assignments (course, section, subject, weekly schedule) are managed from the &ldquo;Teaching Load&rdquo; module.
          </p>
        </div>
      )}
    </div>
  );
}

// College Office-only editor for Promotion History - split out of
// ExperienceFields since promotion (and salary, see FinancialFields) is no
// longer editable by the owner or their HOD/Principal, only by College Office.
export function PromotionFields({ value, onChange, collegeType }: ModuleFieldsProps & { collegeType?: CollegeType }) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  return (
    <RepeatingGroup
      title="Promotion History"
      items={value.promotionHistory}
      empty={EMPTY_PROMOTION}
      onChange={(v) => set("promotionHistory", v)}
      renderRow={(item, update) => (
        <>
          {/* Both ends of a promotion are drawn from this college's own
              designation catalogue rather than typed - a promotion can cross
              between teaching and supporting, so neither side is narrowed by
              `kind`. */}
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
  );
}

// Publications themselves are no longer self-editable here - R&D owns the
// official publication record (see the Research Publications module page,
// which now reads from GET /api/college/publications). Only the aggregate
// self-reported bibliometrics/IDs stay editable.
export function ResearchFields({ value, onChange }: ModuleFieldsProps) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Individual publication records are maintained by the R&amp;D office - view them on the Research Publications module.
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
    </div>
  );
}

export function GrantsFields({ value, onChange }: ModuleFieldsProps) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  const patents = value.patents;
  return (
    <div className="space-y-5">
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
    </div>
  );
}

export function MentorshipFields({ value, onChange }: ModuleFieldsProps) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  const phdPursuing = value.phdScholarsPursuing;
  const phdAwarded = value.phdScholarsAwarded;
  return (
    <div className="space-y-5">
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
    </div>
  );
}

export function FinancialFields({ value, onChange }: ModuleFieldsProps) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  return (
    <div className="space-y-5">
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
    </div>
  );
}

export function OthersFields({ value, onChange }: ModuleFieldsProps) {
  return (
    <div className="space-y-2">
      <Label>Other Information</Label>
      <Textarea
        value={value.otherInformation ?? ""}
        onChange={(e) => onChange({ ...value, otherInformation: e.target.value })}
        placeholder="Anything not covered above - add it here"
        rows={4}
      />
    </div>
  );
}
