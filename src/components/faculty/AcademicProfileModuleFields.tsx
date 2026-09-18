"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { DesignationSelect } from "@/components/faculty/DesignationOptions";
import { TrainingEntryFields } from "@/components/faculty/TrainingEntryFields";
import {
  NumInput, TextInput, DateInput, DegreeFields, DegreeFieldsList, RepeatingGroup, QualificationsFields, StringListInput,
} from "@/components/shared/ProfileFieldPrimitives";
import { SCHOOL_TEACHING_QUALIFICATION_LEVELS } from "@/lib/designations/config";
import { durationBetween, formatDuration, totalYearsOfExperience, allPreviousExperienceEntries, findOverlappingExperience } from "@/lib/faculty/experienceCalc";
import type {
  FacultyProfileFields,
  CollegeType,
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
  AuthoredBook,
} from "@/types";
import {
  PROFESSIONAL_BODY_LABELS, MEMBERSHIP_VALIDITY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS, QUALIFYING_EXAM_LABELS,
  AWARD_LEVEL_LABELS,
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

const EMPTY_LAB: LabEstablished = { facilityDetails: "", outcomes: "" };
const EMPTY_PREVIOUS_INSTITUTION: PreviousInstitution = { institutionName: "", designation: "" };
const EMPTY_PROMOTION: PromotionRecord = { designation: "" };
const EMPTY_TRAINING: TrainingEntry = { type: "FDP", title: "", organizer: "" };
const EMPTY_MEMBERSHIP: ProfessionalMembership = { body: "IEEE" };
const EMPTY_ADMIN_RESPONSIBILITY: AdminResponsibilityEntry = { category: "COMMITTEE_MEMBER", description: "" };
const EMPTY_AWARD: AwardEntry = { category: "BEST_TEACHER", title: "", awardingBody: "", year: new Date().getFullYear() };
const EMPTY_BOOK: AuthoredBook = { title: "", publisher: "", year: new Date().getFullYear() };

export function QualificationFields({ value, onChange, collegeType }: ModuleFieldsProps & { collegeType?: CollegeType }) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }

  if (collegeType === "SCHOOL") {
    return (
      <div className="space-y-5">
        <TextInput label="Highest Qualification" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. B.Ed, M.A." />
        <StringListInput label="Research Areas/Interests *" values={value.researchAreas} onChange={(v) => set("researchAreas", v)} placeholder="e.g. Machine Learning - press Enter or Add" />
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
      <TextInput label="Highest Qualification" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. Ph.D" />
      <StringListInput label="Research Areas/Interests *" values={value.researchAreas} onChange={(v) => set("researchAreas", v)} placeholder="e.g. Machine Learning - press Enter or Add" />
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
      <DegreeFields label="Ph.D. Details" level="DOCTORAL" value={value.phdDetails} onChange={(v) => set("phdDetails", v)} />
      <DegreeFieldsList label="Ph.D. Details" level="DOCTORAL" items={value.additionalPhdDetails} onChange={(v) => set("additionalPhdDetails", v)} />
      <DegreeFields label="Postdoctoral Fellowship Details" level="POST_DOCTORAL" value={value.postDoctoralDetails} onChange={(v) => set("postDoctoralDetails", v)} />
    </div>
  );
}

// Academic/Industry/Research Experience are 3 tabs sharing this exact row
// shape (PreviousInstitution) and layout - only the Institution/Teaching-Role
// labels and which FacultyProfileFields array they read/write differ, so one
// tab config drives all three instead of tripling the JSX.
const EXPERIENCE_TABS = [
  {
    key: "academic", label: "Academic Experience", field: "previousInstitutions",
    institutionLabel: "Institution Name", roleSectionLabel: "Teaching Role", roleFieldLabel: "Teaching Roles/Responsibilities",
  },
  {
    key: "industry", label: "Industry Experience", field: "industryExperienceEntries",
    institutionLabel: "Name of the Industry", roleSectionLabel: "Industry Roles", roleFieldLabel: "Industry Roles/Responsibilities",
  },
  {
    key: "research", label: "Research Experience", field: "researchExperienceEntries",
    institutionLabel: "Research Organization Name", roleSectionLabel: "Research Role", roleFieldLabel: "Research Roles/Responsibilities",
  },
] as const;

export function ExperienceFields({ value, onChange, includeTeachingAssignment = true }: ModuleFieldsProps & { includeTeachingAssignment?: boolean }) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  const teaching = value.teachingAssignment;
  const [activeTabKey, setActiveTabKey] = useState<(typeof EXPERIENCE_TABS)[number]["key"]>("academic");
  const activeTab = EXPERIENCE_TABS.find((t) => t.key === activeTabKey) ?? EXPERIENCE_TABS[0];
  const items = value[activeTab.field];
  // Each tab's "Roles/Responsibilities" box writes its own field - previously
  // all 3 tabs shared teachingAssignment.primaryTeachingRole, so filling in
  // e.g. the Industry tab's box silently overwrote the Academic tab's value.
  const activeRoleValue =
    activeTab.key === "academic" ? teaching?.primaryTeachingRole
      : activeTab.key === "industry" ? value.primaryIndustryRole
        : value.primaryResearchRole;
  function setActiveRole(v: string) {
    if (activeTab.key === "academic") set("teachingAssignment", { primaryTeachingRole: v, courses: teaching?.courses ?? [] });
    else if (activeTab.key === "industry") set("primaryIndustryRole", v);
    else set("primaryResearchRole", v);
  }
  // All 3 tabs combined - no Date of Joining here, so this is deliberately
  // not the same figure as the "Total Years of Experience" fact shown on the
  // profile (FacultyProfileHub), which also adds time served since joining
  // and keeps ticking up day by day.
  const previousExperienceTotal = totalYearsOfExperience(allPreviousExperienceEntries(value), undefined);
  const allExperienceEntries = allPreviousExperienceEntries(value);
  // Previous Experience is, by definition, in the past - never let From/To
  // Date land after today.
  const today = new Date().toISOString().slice(0, 10);
  // Which tab a given row (matched by reference) belongs to - so an overlap
  // warning can name the OTHER tab when the conflicting row isn't on the
  // one currently open (e.g. an Industry Experience row overlapping an
  // Academic Experience one).
  function tabLabelForEntry(entry: { institutionName?: string }): string {
    return EXPERIENCE_TABS.find((t) => (value[t.field] ?? []).some((x) => (x as unknown) === entry))?.label ?? "another entry";
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {EXPERIENCE_TABS.map((t) => (
          <button
            type="button"
            key={t.key}
            onClick={() => setActiveTabKey(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeTabKey === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <RepeatingGroup
        title={activeTab.label}
        items={items}
        empty={EMPTY_PREVIOUS_INSTITUTION}
        onChange={(v) => set(activeTab.field, v)}
        renderRow={(item, update) => {
          // Falls back to Jan 1 of the legacy year-only value so an older
          // record still shows something to correct, rather than blank -
          // same read-time seeding as legacyProfileFallbacks.ts. Saving
          // the form (even untouched) persists the real fromDate/toDate.
          const fromDate = item.fromDate ?? (item.fromYear ? `${item.fromYear}-01-01` : undefined);
          const toDate = item.toDate ?? (item.toYear ? `${item.toYear}-01-01` : undefined);
          const rowDuration = durationBetween(fromDate, toDate);
          // Checked against ALL Academic/Industry/Research Experience rows
          // combined, not just this tab's own - the three roll up into one
          // Total Years of Experience (see experienceCalc.ts), so an
          // overlap anywhere would double-count those days regardless of
          // which tab it's on.
          const overlap = findOverlappingExperience(allExperienceEntries, item);
          return (
            <>
              <TextInput label={activeTab.institutionLabel} value={item.institutionName} onChange={(v) => update({ institutionName: v })} />
              <TextInput label="Designation" value={item.designation} onChange={(v) => update({ designation: v })} />
              <DateInput
                label="From Date"
                value={fromDate}
                // max steers the native picker; the clamp below is the
                // actual guarantee since a typed/pasted value can still
                // bypass max - never let From Date land in the future.
                onChange={(v) => update({ fromDate: v && v > today ? today : v })}
                max={today}
              />
              <DateInput
                label="To Date"
                value={toDate}
                // min/max steer the native picker; the clamp below is the
                // actual guarantee since a typed/pasted value can still
                // bypass them - never let To Date land before From Date or
                // after today.
                onChange={(v) => update({ toDate: fromDate && v && v < fromDate ? fromDate : v && v > today ? today : v })}
                min={fromDate}
                max={today}
              />
              {(rowDuration.years > 0 || rowDuration.months > 0 || rowDuration.days > 0) && (
                <p className="sm:col-span-2 text-xs text-muted-foreground">
                  Experience: <span className="font-medium text-foreground">{formatDuration(rowDuration)}</span>
                </p>
              )}
              {overlap && (
                <p className="sm:col-span-2 text-xs text-destructive">
                  Overlaps {overlap.entry.institutionName ? `${overlap.entry.institutionName} - ` : ""}
                  {tabLabelForEntry(overlap.entry)} ({overlap.fromDate} to {overlap.toDate}) - adjust the dates so
                  experience periods don&rsquo;t overlap.
                </p>
              )}
              <NumInput label="Joining Salary" value={item.joiningSalary} onChange={(v) => update({ joiningSalary: v })} />
              <NumInput label="Leaving Salary" value={item.leavingSalary} onChange={(v) => update({ leavingSalary: v })} />
              {includeTeachingAssignment && (
                <div className="sm:col-span-2 space-y-3 rounded-lg border p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{activeTab.roleSectionLabel}</p>
                  <TextInput
                    label={activeTab.roleFieldLabel}
                    value={activeRoleValue}
                    onChange={setActiveRole}
                  />
                  <p className="text-xs text-muted-foreground">
                    Subject-level teaching assignments (course, section, subject, weekly schedule) are managed from the &ldquo;Teaching Load&rdquo; module.
                  </p>
                </div>
              )}
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
          );
        }}
      />
      {(items?.length ?? 0) > 0 && (
        <p className="text-sm rounded-md border bg-muted/20 p-2">
          {activeTab.label} Total: <span className="font-semibold">{formatDuration(totalYearsOfExperience(items, undefined))}</span>
        </p>
      )}
      <p className="text-sm rounded-md border bg-muted/20 p-2">
        Previous Experience Total (all 3 tabs combined): <span className="font-semibold">{formatDuration(previousExperienceTotal)}</span>
        <span className="text-xs text-muted-foreground"> — combined with time served since Date of Joining, this becomes the Total Years of Experience shown on this faculty member&rsquo;s profile.</span>
      </p>
      <p className="text-xs text-muted-foreground rounded-md border bg-muted/20 p-2">
        Promotion History is maintained by the College Office - it can no longer be edited here.
      </p>
    </div>
  );
}

// College Office-only editor for designation/experience history - split out
// of ExperienceFields since this (and salary, see FinancialFields) is no
// longer editable by the owner or their HOD/Principal, only by College
// Office. One row per designation held: From/To Date bound it, and the
// experience actually served in that one designation is computed from those
// dates (durationBetween) rather than typed in - a blank To Date means still
// serving in that designation, so its experience is computed up to today and
// keeps increasing day by day until a To Date is set (same live-ticking idea
// ExperienceFields' own "Total Years of Experience" fact uses).
export function PromotionFields({ value, onChange }: ModuleFieldsProps & { collegeType?: CollegeType }) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <RepeatingGroup
      title="Teaching"
      items={value.promotionHistory}
      empty={EMPTY_PROMOTION}
      onChange={(v) => set("promotionHistory", v)}
      renderRow={(item, update) => {
        const duration = durationBetween(item.fromDate, item.toDate || today);
        return (
          <>
            {/* Drawn from this college's own designation catalogue rather
                than typed - not narrowed by `kind` since this same field is
                shared with Supporting/Non-Technical Staff's own promotion
                page (see College Office staff/[uid]/promotion-salary). */}
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
  );
}

// Publications themselves are no longer self-editable here - R&D owns the
// official publication record (see the Research & Innovation module page,
// which now reads from GET /api/college/publications). Only the aggregate
// self-reported bibliometrics/IDs stay editable.
export function ResearchFields({ value, onChange }: ModuleFieldsProps) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Individual publication records are maintained by the R&amp;D office - view them on the Research &amp; Innovation module.
        The fields below are self-reported summary metrics.
      </p>
      {/* Hidden for now - Research Publications is getting a proper field
          redesign (see ResearchInnovationModule's sub-tabs); re-enable once
          that's in and these are re-decided as part of it, not before.
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
      */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Research Profiles</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextInput label="ORCID iD" value={value.orcidId} onChange={(v) => set("orcidId", v)} />
        <TextInput label="Scopus Author ID" value={value.scopusAuthorId} onChange={(v) => set("scopusAuthorId", v)} />
        <TextInput label="Researcher ID" value={value.researcherId} onChange={(v) => set("researcherId", v)} />
        <TextInput label="Google Scholar ID" value={value.googleScholarId} onChange={(v) => set("googleScholarId", v)} />
        <TextInput label="IRINS Profile" value={value.irinsProfile} onChange={(v) => set("irinsProfile", v)} />
      </div>
    </div>
  );
}

export function MentorshipFields({
  value, onChange, ownerFacultyId, ownerFacultyName,
}: ModuleFieldsProps & { ownerFacultyId?: string; ownerFacultyName?: string }) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }
  return (
    <div className="space-y-5">
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
        renderRow={(item, update) => {
          // Falls back to Jan 1 of the legacy year-only value so an older
          // record still shows something to correct, rather than blank -
          // same read-time seeding ExperienceFields uses for Previous
          // Experience. Saving the form (even untouched) persists the real
          // fromDate/toDate.
          const fromDate = item.fromDate ?? (item.fromYear ? `${item.fromYear}-01-01` : undefined);
          const toDate = item.toDate ?? (item.toYear ? `${item.toYear}-01-01` : undefined);
          return (
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
              <DateInput label="From Date" value={fromDate} onChange={(v) => update({ fromDate: v })} />
              <DateInput
                label="To Date (leave blank if ongoing)"
                value={toDate}
                onChange={(v) => update({ toDate: fromDate && v && v < fromDate ? fromDate : v })}
                min={fromDate}
              />
              {!toDate && <p className="sm:col-span-2 text-xs text-muted-foreground">No To Date yet - shown as <span className="font-medium text-foreground">Ongoing</span> until one is set.</p>}
            </>
          );
        }}
      />
      <RepeatingGroup
        title="FDPs, Workshops, MOOCs & Certifications"
        items={value.trainingEntries}
        empty={() => ({ ...EMPTY_TRAINING, id: crypto.randomUUID() })}
        onChange={(v) => set("trainingEntries", v)}
        renderRow={(item, update) => (
          <TrainingEntryFields item={item} update={update} ownerFacultyId={ownerFacultyId} ownerFacultyName={ownerFacultyName} />
        )}
      />
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
            <TextInput label="Title of Award" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Awarding Agency/Body" value={item.awardingBody} onChange={(v) => update({ awardingBody: v })} />
            <DateInput
              label="Date of Award"
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
        <NumInput label="Monthly Salary (₹)" value={value.presentSalary} onChange={(v) => set("presentSalary", v)} />
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
