"use client";

import {
  Section, SubLabel, Field, DegreeView, DocField, QualificationsView,
} from "@/components/shared/ProfileFieldPrimitives";
import { designationLabel } from "@/lib/designations/config";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { PublicationsSection } from "@/components/faculty/PublicationsModuleView";
import { normalizeResourcePersonsDetails } from "@/components/faculty/TrainingEntryFields";
import { awardYear } from "@/lib/faculty/awardYear";
import { totalYearsOfExperience, formatDuration, durationBetween, allPreviousExperienceEntries } from "@/lib/faculty/experienceCalc";
import { toDate } from "@/lib/utils";
import {
  TRAINING_ENTRY_TYPE_LABELS, TRAINING_PARTICIPATION_ROLE_LABELS, CERTIFICATION_TYPE_LABELS, PROFESSIONAL_BODY_LABELS, MEMBERSHIP_VALIDITY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS, QUALIFYING_EXAM_LABELS,
  TRAINING_PROGRAM_LEVEL_LABELS, TRAINING_PROGRAM_MODE_LABELS, AWARD_LEVEL_LABELS,
} from "@/types";
import type { FacultyProfileFields, CollegeType, ResearchPublication, TrainingEntry, PreviousInstitution } from "@/types";

// "Beneficiaries" value for the read-only view: who this program served (the
// edit form, TrainingEntryFields, captures the detailed breakdown). The counts
// are shown as their own Total Count / Internal Count / External Count fields.
function beneficiarySummary(t: TrainingEntry): string | undefined {
  if (t.beneficiaries === "STUDENTS") {
    const parts = (t.beneficiaryDepartments ?? []).map(
      (d) => `${d.courseName} - ${d.department} Yr ${d.year} (${d.sections.map((s) => `${s.sectionName}: ${s.count}`).join(", ")})`
    );
    return parts.length > 0 ? `Students - ${parts.join("; ")}` : "Students";
  }
  if (t.beneficiaries === "FACULTY") return "Faculty";
  return undefined;
}

// Prefers the real date; falls back to the legacy year-only value for a
// record that hasn't been re-saved under the new shape yet (see
// PreviousInstitution's own doc-comment in types/core.ts).
function formatInstitutionDate(date: string | undefined, year: number | undefined): string | number | undefined {
  if (date) {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }
  return year;
}

interface Props {
  profile: Partial<FacultyProfileFields> | undefined;
  includeTeachingAssignment?: boolean;
  hideFinancialModule?: boolean;
  collegeType?: CollegeType;
  // R&D-managed publication records for this person - the caller fetches
  // these itself (source varies: /api/college/publications for college-scoped
  // sessions, an embedded field for Management's separate API surface - see
  // the two management/faculty pages). Undefined while still loading.
  publications?: ResearchPublication[];
}

// ─── Per-module content (Modules 1-8, FacultyProfileFields) ────────────────────
// Each exported standalone so a per-module page (see profileModules.ts /
// FacultyProfileModuleContent) can render exactly one, instead of the whole
// scrolling ProfileFieldsView below.

export function QualificationModule({ profile, collegeType }: { profile: Partial<FacultyProfileFields> | undefined; collegeType?: CollegeType }) {
  // Lift legacy key names on un-migrated docs (see academicProfileCompat.ts).
  const p = normalizeAcademicProfile(profile) ?? {};
  if (collegeType === "SCHOOL") {
    return (
      <Section number={1} title="General & Academic Profile">
        <Field label="Highest Qualification" value={p.highestQualification} />
        <Field label="Research Areas/Interests" value={(p.researchAreasInterests ?? []).join(", ")} />
        <QualificationsView items={p.educationalQualifications} />
      </Section>
    );
  }
  return (
    <Section number={1} title="General & Academic Profile">
      <Field label="Highest Qualification" value={p.highestQualification} />
      <Field label="Research Areas/Interests" value={(p.researchAreasInterests ?? []).join(", ")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="NET/SLET/SET/GATE/Others" value={p.netSletSetGateOthers === "YES" ? "Yes" : p.netSletSetGateOthers === "NO" ? "No" : undefined} />
        {p.netSletSetGateOthers === "YES" && (
          <>
            <Field label="Qualified Exam" value={p.qualifiedExam === "OTHER" ? (p.pleaseSpecifyExam || "Other") : (p.qualifiedExam ? QUALIFYING_EXAM_LABELS[p.qualifiedExam] : undefined)} />
            <Field label="Exam Score" value={p.examScore} />
            <Field label="Qualified Year" value={p.qualifiedYear} />
          </>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DegreeView label="Secondary Education" degree={p.secondaryEducation} level="HIGH_SCHOOL" />
        <DegreeView label="Intermediate / Diploma / ITI" degree={p.intermediateDiplomaIti} level="INTERMEDIATE" />
        <DegreeView label="UG Details" degree={p.ugDetails} level="UG" />
        {(p.additionalUgDetails ?? []).map((d, i) => <DegreeView key={`ug-${i}`} label={`UG Details ${i + 2}`} degree={d} level="UG" />)}
        <DegreeView label="PG Details" degree={p.pgDetails} level="PG" />
        {(p.additionalPgDetails ?? []).map((d, i) => <DegreeView key={`pg-${i}`} label={`PG Details ${i + 2}`} degree={d} level="PG" />)}
        <DegreeView label="Ph.D. Details" degree={p.phdDetails} level="DOCTORAL" />
        {(p.additionalPhdDetails ?? []).map((d, i) => <DegreeView key={`phd-${i}`} label={`Ph.D. Details ${i + 2}`} degree={d} level="DOCTORAL" />)}
        <DegreeView label="Postdoctoral Fellowship Details" degree={p.postdoctoralFellowshipDetails} level="POST_DOCTORAL" />
      </div>
    </Section>
  );
}

export function ExperienceModule({
  profile, includeTeachingAssignment = true, joiningDate,
}: {
  profile: Partial<FacultyProfileFields> | undefined;
  includeTeachingAssignment?: boolean;
  // Optional - when the caller has it (FacultyProfileModuleContent does),
  // shows the live "Total Years of Experience" fact (Previous Experience
  // rows + time served since joining, ticking up day by day - see
  // experienceCalc.ts) above the row list. Omitted entirely otherwise.
  joiningDate?: Parameters<typeof toDate>[0];
}) {
  // Lift legacy key names on un-migrated docs (see academicProfileCompat.ts).
  const p = normalizeAcademicProfile(profile) ?? {};
  const teaching = p.teachingAssignment;
  const allExperienceEntries = allPreviousExperienceEntries(p);
  const hasExperienceData = !!(joiningDate || allExperienceEntries.length > 0);
  // `unplacedRole` is legacy shared text normalizeAcademicProfile could not move onto an
  // entry (nothing to hold it, or the latest entry already has different text) - shown
  // read-only so it never silently disappears.
  const experienceGroups: { label: string; entries: PreviousInstitution[]; roleLabel: string; unplacedRole: string | undefined }[] = [
    { label: "Academic Experience", entries: p.academicExperience ?? [], roleLabel: "Academic Roles/Responsibilities", unplacedRole: p.teachingRolesResponsibilities },
    { label: "Industry Experience", entries: p.industryExperience ?? [], roleLabel: "Industry Roles/Responsibilities", unplacedRole: p.industryRolesResponsibilities },
    { label: "Research Experience", entries: p.researchExperience ?? [], roleLabel: "Research Roles/Responsibilities", unplacedRole: p.researchRolesResponsibilities },
  ];
  return (
    <Section number={2} title="Previous Experience">
      {hasExperienceData && (
        <Field label="Total Years of Experience" value={formatDuration(totalYearsOfExperience(allExperienceEntries, joiningDate))} />
      )}
      {experienceGroups.map((group) => (
        <div className="space-y-2" key={group.label}>
          <SubLabel>{group.label}</SubLabel>
          {group.unplacedRole && <Field label={`${group.roleLabel} (legacy, not tied to an entry)`} value={group.unplacedRole} />}
          {group.entries.length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
            <div className="space-y-2">
              {group.entries.map((inst, i) => (
                <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Field label="Institution Name" value={inst.institutionName} />
                  <Field label="Designation" value={inst.designation} />
                  <Field label="From Date" value={formatInstitutionDate(inst.fromDate, inst.fromYear)} />
                  <Field label="To Date" value={formatInstitutionDate(inst.toDate, inst.toYear)} />
                  <Field label="Joining Salary" value={inst.joiningSalary} />
                  <Field label="Leaving Salary" value={inst.leavingSalary} />
                  <Field label={group.roleLabel} value={inst.rolesResponsibilities} />
                  <Field label="Reason for Leaving" value={inst.reasonForLeaving} />
                  <Field label="NOC Obtained" value={inst.nocObtained === "YES" ? "Yes" : inst.nocObtained === "NO" ? "No" : undefined} />
                  <DocField label="Experience Certificate" url={inst.experienceCertificateUrl} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="space-y-2">
        <SubLabel>Promotion History</SubLabel>
        {(p.promotionHistory ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          <div className="space-y-2">
            {p.promotionHistory?.map((promo, i) => (
              <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {/* Stored as a catalogue code (ASSISTANT_PROFESSOR, …) since
                    it's a dropdown - labelled here so the view doesn't show
                    the raw code. Free text from "Other" passes through
                    designationLabel unchanged. */}
                <Field label="Designation" value={designationLabel(promo.designation)} />
                <Field
                  label="Experience in this Designation"
                  value={promo.fromDate ? formatDuration(durationBetween(promo.fromDate, promo.toDate || new Date().toISOString().slice(0, 10))) : undefined}
                />
                <Field label="From Date" value={promo.fromDate} />
                <Field label="To Date" value={promo.toDate ?? "Ongoing"} />
                <DocField label="Promotion Order" url={promo.promotionOrderUrl} />
              </div>
            ))}
          </div>
        )}
      </div>
      {includeTeachingAssignment && (
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3 space-y-2">
          <SubLabel>Current Teaching Assignment</SubLabel>
          {(teaching?.courses ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No courses recorded.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {teaching?.courses.map((c, i) => (
                <div key={i} className="rounded-md bg-background shadow-sm border p-2">
                  <p className="text-sm font-medium">{c.code} - {c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.weeklyCreditHours} hrs/week</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// Individual publication records are R&D-managed (see PublicationsModuleView) -
// this just renders whatever list the caller already fetched from R&D's API
// surface. `publications` is undefined while the caller is still loading it.
export function ResearchModule({ profile, publications }: { profile: Partial<FacultyProfileFields> | undefined; publications?: ResearchPublication[] }) {
  return <PublicationsSection publications={publications ?? null} academicProfile={profile} />;
}

// The researcher IDs/links - split out of ResearchModule so this flat view
// mirrors ResearchInnovationModule's tab split (Research Publications vs.
// Research Profiles), same underlying academicProfile fields either way.
export function ResearchProfilesModule({ profile }: { profile: Partial<FacultyProfileFields> | undefined }) {
  const p = profile ?? {};
  return (
    <Section number={3} title="Research Profiles">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="ORCID iD" value={p.orcidId} />
        <Field label="Scopus Author ID" value={p.scopusAuthorId} />
        <Field label="Researcher ID" value={p.researcherId} />
        <Field label="Google Scholar ID" value={p.googleScholarId} />
        <Field label="IRINS Profile" value={p.irinsProfile} />
      </div>
    </Section>
  );
}

export function MentorshipModule({
  profile, ownerName,
}: {
  profile: Partial<FacultyProfileFields> | undefined;
  // This profile's own display name - fallback for entry #1 in a "Conducted"
  // training entry's Name of the Faculty / Coordinator when its stored value
  // is blank (a record saved before TrainingEntryFields started keeping that
  // field reliably in sync - see its own doc-comment). Omitted entirely
  // falls back further to "-".
  ownerName?: string;
}) {
  // Lift legacy key names on un-migrated docs (see academicProfileCompat.ts).
  const p = normalizeAcademicProfile(profile) ?? {};
  return (
    <Section number={5} title="Professional Development">
      <div className="space-y-2">
        <SubLabel>New Labs Established</SubLabel>
        {(p.newLabsEstablished ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.newLabsEstablished?.map((lab, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Field label="Facility Details" value={lab.facilityDetails} />
              <Field label="Outcomes" value={lab.outcomes} />
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>Academic Responsibilities</SubLabel>
        {(p.academicResponsibilities ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.academicResponsibilities?.map((r, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Category" value={ADMIN_RESPONSIBILITY_CATEGORY_LABELS[r.category]} />
              {r.category === "OTHER" && <Field label="Other Category" value={r.otherCategory} />}
              <Field label="Description" value={r.description} />
              <Field label="From Date" value={formatInstitutionDate(r.fromDate, r.fromYear)} />
              <Field label="To Date" value={formatInstitutionDate(r.toDate, r.toYear) ?? "Ongoing"} />
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>FDPs, Workshops, MOOCs &amp; Certifications</SubLabel>
        {(p.fdpsWorkshopsMoocsCertifications ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.fdpsWorkshopsMoocsCertifications?.map((t, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Type" value={TRAINING_ENTRY_TYPE_LABELS[t.type]} />
              {t.type === "OTHER" && <Field label="Please specify type" value={t.pleaseSpecifyType} />}
              <Field label="Certification Type" value={t.certificationType ? CERTIFICATION_TYPE_LABELS[t.certificationType] : undefined} />
              <Field label="Participated or Conducted" value={t.participatedOrConducted ? TRAINING_PARTICIPATION_ROLE_LABELS[t.participatedOrConducted] : undefined} />
              <Field label="Title of the Program" value={t.titleOfTheProgram} />
              <Field label="Name of the Faculty / Coordinator" value={t.nameOfTheFacultyCoordinator || (t.isCoConductedCopy ? t.ownerFacultyName : ownerName)} />
              <Field label="From Date" value={t.fromDate} />
              <Field label="To Date" value={t.toDate} />
              <Field label="Duration" value={t.duration ? `${t.duration} day${t.duration === 1 ? "" : "s"}` : undefined} />
              <Field label="Number of Weeks" value={t.numberOfWeeks} />
              <Field label="National / International" value={t.nationalInternational ? TRAINING_PROGRAM_LEVEL_LABELS[t.nationalInternational] : undefined} />
              <Field label="Place" value={t.place} />
              <Field label="Mode of the Program" value={t.modeOfTheProgram ? TRAINING_PROGRAM_MODE_LABELS[t.modeOfTheProgram] : undefined} />
              <Field label="Beneficiaries" value={beneficiarySummary(t)} />
              {t.beneficiaries && <Field label="Total Count" value={t.totalCount} />}
              {t.beneficiaries === "FACULTY" && <Field label="Internal Count" value={t.internalCount} />}
              {t.beneficiaries === "FACULTY" && <Field label="External Count" value={t.externalCount} />}
              <Field label="Number of Resource Persons" value={t.numberOfResourcePersons} />
              <Field
                label="Resource Persons - Details"
                value={(() => {
                  const list = normalizeResourcePersonsDetails(t.resourcePersonsDetails);
                  return list.length > 0 ? list.map((d, i) => `${i + 1}. ${d}`).join(", ") : undefined;
                })()}
              />
              {!t.fromDate && t.year && <Field label="Year (legacy)" value={t.year} />}
              {/* The coordinator is entry #1 (shown above as the Name of the
                  Faculty / Coordinator); the co-conducting faculty follow as
                  #2, #3, ... - same numbering as the edit form. */}
              {(t.coConductingFaculty ?? []).length > 0 && (
                <Field
                  label="Co-Conducting Faculty"
                  value={t.coConductingFaculty!.map((c) => `${c.order}. ${c.name} (${c.department})`).join(", ")}
                />
              )}
              {t.participatedOrConducted === "PARTICIPATED" && <Field label="Remark" value={t.remark} />}
              <Field label="Other Details" value={t.otherDetails} />
              <DocField label="Certificate" url={t.certificateUrl} />
              <DocField label="Brochure" url={t.brochureUrl} />
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>Professional Memberships</SubLabel>
        {(p.professionalMemberships ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.professionalMemberships?.map((m, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Field label="Body" value={PROFESSIONAL_BODY_LABELS[m.body]} />
              {m.body === "OTHER" && <Field label="Body Name" value={m.bodyName} />}
              <Field label="Membership Type" value={m.membershipType} />
              <Field label="Membership ID" value={m.membershipId} />
              <Field label="Membership Validity" value={m.membershipValidity ? MEMBERSHIP_VALIDITY_LABELS[m.membershipValidity] : undefined} />
              {m.membershipValidity === "ANNUAL" ? (
                <>
                  <Field label="Valid From" value={m.validFrom} />
                  <Field label="Valid To" value={m.validTo} />
                </>
              ) : (
                <Field label="Member Since" value={m.memberSince ?? m.sinceMonthYear ?? (m.sinceYear ? String(m.sinceYear) : undefined)} />
              )}
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>Awards &amp; Recognition</SubLabel>
        {(p.awardsRecognition ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.awardsRecognition?.map((a, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Category" value={AWARD_CATEGORY_LABELS[a.category]} />
              {a.category === "OTHER" && <Field label="Other Category" value={a.otherCategory} />}
              <Field label="Title of Award" value={a.titleOfAward} />
              <Field label="Awarding Agency/Body" value={a.awardingAgencyBody} />
              {/* dateOfAward, falling back to the legacy year-only value on a record not re-saved yet */}
              <Field label="Date of Award" value={a.dateOfAward ?? awardYear(a)} />
              <Field label="State / National / International" value={a.stateNationalInternational ? AWARD_LEVEL_LABELS[a.stateNationalInternational] : undefined} />
              <Field label="Other Details" value={a.otherDetails} />
              <DocField label="Certificate" url={a.certificateUrl} />
            </div>
          ))
        )}
      </div>
    </Section>
  );
}

export function FinancialModule({ profile }: { profile: Partial<FacultyProfileFields> | undefined }) {
  // Lift legacy key names on un-migrated docs (see academicProfileCompat.ts).
  const p = normalizeAcademicProfile(profile) ?? {};
  return (
    <Section number={6} title="Financial Standing & Budgetary Impact">
      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <SubLabel>Current Financial Standing</SubLabel>
        <div className="mt-2">
          <Field label="Monthly Salary (₹)" value={p.monthlySalary} />
        </div>
      </div>
      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <SubLabel>Budgetary Impact</SubLabel>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Gross Annual CTC (₹)" value={p.grossAnnualCTC} />
          <Field label="Increments Awarded" value={p.incrementsAwarded} />
          <Field label="Funding/Consultancy Revenue Generation (₹)" value={p.fundingConsultancyRevenueGeneration} />
        </div>
      </div>
    </Section>
  );
}

export function OthersModule({ profile }: { profile: Partial<FacultyProfileFields> | undefined }) {
  const p = profile ?? {};
  return (
    <Section number={7} title="Others">
      <p className="text-sm whitespace-pre-wrap">{p.otherInformation || "-"}</p>
    </Section>
  );
}

// Full scrolling view - all 7 modules stacked - kept for any caller that still
// wants the single-page layout (e.g. printable exports).
export function ProfileFieldsView({ profile, includeTeachingAssignment = true, hideFinancialModule = false, collegeType, publications }: Props) {
  return (
    <div className="space-y-5">
      <QualificationModule profile={profile} collegeType={collegeType} />
      <ExperienceModule profile={profile} includeTeachingAssignment={includeTeachingAssignment} />
      <ResearchModule profile={profile} publications={publications} />
      <ResearchProfilesModule profile={profile} />
      <MentorshipModule profile={profile} />
      {!hideFinancialModule && <FinancialModule profile={profile} />}
      <OthersModule profile={profile} />
    </div>
  );
}
