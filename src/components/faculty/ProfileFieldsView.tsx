"use client";

import {
  Section, SubLabel, Field, DegreeView, DocLink, QualificationsView,
} from "@/components/shared/ProfileFieldPrimitives";
import { designationLabel } from "@/lib/designations/config";
import { PublicationsSection } from "@/components/faculty/PublicationsModuleView";
import { normalizeResourcePersonsDetails } from "@/components/faculty/TrainingEntryFields";
import { totalYearsOfExperience, formatDuration, durationBetween } from "@/lib/faculty/experienceCalc";
import { toDate } from "@/lib/utils";
import {
  TRAINING_ENTRY_TYPE_LABELS, TRAINING_PARTICIPATION_ROLE_LABELS, PROFESSIONAL_BODY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS, QUALIFYING_EXAM_LABELS,
  TRAINING_PROGRAM_LEVEL_LABELS, TRAINING_PROGRAM_MODE_LABELS, AWARD_LEVEL_LABELS,
} from "@/types";
import type { FacultyProfileFields, CollegeType, ResearchPublication, TrainingEntry } from "@/types";

// One-line "who this program served" summary for the read-only view - the
// edit form (TrainingEntryFields) captures the detailed breakdown, this just
// condenses it for display.
function beneficiarySummary(t: TrainingEntry): string | undefined {
  if (t.beneficiaryType === "STUDENTS") {
    const parts = (t.beneficiaryDepartments ?? []).map(
      (d) => `${d.courseName} - ${d.department} Yr ${d.year} (${d.sections.map((s) => `${s.sectionName}: ${s.count}`).join(", ")})`
    );
    const total = t.beneficiaryTotalCount !== undefined ? `${t.beneficiaryTotalCount} Students` : "Students";
    return parts.length > 0 ? `${total} - ${parts.join("; ")}` : total;
  }
  if (t.beneficiaryType === "FACULTY") {
    const bits = [
      t.beneficiaryTotalCount !== undefined ? `${t.beneficiaryTotalCount} Faculty` : "Faculty",
      t.beneficiaryInternalCount !== undefined ? `${t.beneficiaryInternalCount} Internal` : undefined,
      t.beneficiaryExternalCount !== undefined ? `${t.beneficiaryExternalCount} External` : undefined,
    ].filter(Boolean);
    return bits.join(" · ");
  }
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
  const p = profile ?? {};
  if (collegeType === "SCHOOL") {
    return (
      <Section number={1} title="General & Academic Profile">
        <Field label="Highest Qualification" value={p.highestQualification} />
        <QualificationsView items={p.schoolQualifications} />
      </Section>
    );
  }
  return (
    <Section number={1} title="General & Academic Profile">
      <Field label="Highest Qualification" value={p.highestQualification} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="NET/SLET/SET/GATE/Others" value={p.qualifyingExamQualified === "YES" ? "Yes" : p.qualifyingExamQualified === "NO" ? "No" : undefined} />
        {p.qualifyingExamQualified === "YES" && (
          <>
            <Field label="Qualified Exam" value={p.qualifyingExam ? QUALIFYING_EXAM_LABELS[p.qualifyingExam] : undefined} />
            <Field label="Score" value={p.qualifyingExamScore} />
            <Field label="Qualified Year" value={p.qualifyingExamYear} />
          </>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DegreeView label="Secondary Education" degree={p.highSchoolDetails} level="HIGH_SCHOOL" />
        <DegreeView label="Intermediate (10+2) / Diploma (10+3) / ITI / Others" degree={p.intermediateDetails} level="INTERMEDIATE" />
        <DegreeView label="UG Details" degree={p.ugDetails} level="UG" />
        {(p.additionalUgDetails ?? []).map((d, i) => <DegreeView key={`ug-${i}`} label={`UG Details ${i + 2}`} degree={d} level="UG" />)}
        <DegreeView label="PG Details" degree={p.pgDetails} level="PG" />
        {(p.additionalPgDetails ?? []).map((d, i) => <DegreeView key={`pg-${i}`} label={`PG Details ${i + 2}`} degree={d} level="PG" />)}
        <DegreeView
          label="Ph.D. Details"
          degree={p.phdDetails}
          level="DOCTORAL"
          status={p.phdStatus}
          extraFields={
            <>
              <Field label="Ph.D. Status" value={p.phdStatus} />
              <Field label="Ph.D. Mode" value={p.phdMode} />
            </>
          }
        />
        {(p.additionalPhdDetails ?? []).map((d, i) => <DegreeView key={`phd-${i}`} label={`Ph.D. Details ${i + 2}`} degree={d} level="DOCTORAL" />)}
        <DegreeView
          label="Postdoctoral Fellowship Details"
          degree={p.postDoctoralDetails}
          level="POST_DOCTORAL"
          status={p.postDoctoralStatus}
          extraFields={
            <>
              <Field label="Postdoctoral Status" value={p.postDoctoralStatus} />
              <Field label="Postdoctoral Mode" value={p.postDoctoralMode} />
            </>
          }
        />
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
  const p = profile ?? {};
  const teaching = p.teachingAssignment;
  const hasExperienceData = !!(joiningDate || (p.previousInstitutions?.length ?? 0) > 0);
  return (
    <Section number={2} title="Previous Experience">
      {hasExperienceData && (
        <Field label="Total Years of Experience" value={formatDuration(totalYearsOfExperience(p.previousInstitutions, joiningDate))} />
      )}
      <div className="space-y-2">
        <SubLabel>Previous Institutions Worked At</SubLabel>
        {(p.previousInstitutions ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          <div className="space-y-2">
            {p.previousInstitutions?.map((inst, i) => (
              <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Field label="Institution Name" value={inst.institutionName} />
                <Field label="Designation" value={inst.designation} />
                <Field label="From" value={formatInstitutionDate(inst.fromDate, inst.fromYear)} />
                <Field label="To" value={formatInstitutionDate(inst.toDate, inst.toYear)} />
                <Field label="Joining Salary" value={inst.joiningSalary} />
                <Field label="Leaving Salary" value={inst.leavingSalary} />
                <Field label="Reason for Leaving" value={inst.reasonForLeaving} />
                <Field label="NOC Obtained" value={inst.nocObtained === "YES" ? "Yes" : inst.nocObtained === "NO" ? "No" : undefined} />
                {inst.experienceCertificateUrl && (
                  <div className="col-span-2 sm:col-span-3">
                    <DocLink url={inst.experienceCertificateUrl} label="View Experience Certificate" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <SubLabel>Teaching</SubLabel>
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
                <Field label="From" value={promo.fromDate} />
                <Field label="To" value={promo.toDate ?? "Ongoing"} />
                {promo.orderUrl && (
                  <div className="col-span-2 sm:col-span-3">
                    <DocLink url={promo.orderUrl} label="View Promotion Order" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {includeTeachingAssignment && (
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3 space-y-2">
          <SubLabel>Current Teaching Assignment</SubLabel>
          <Field label="Primary Teaching Role" value={teaching?.primaryTeachingRole} />
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

export function GrantsModule({ profile }: { profile: Partial<FacultyProfileFields> | undefined }) {
  const p = profile ?? {};
  const patents = p.patents;
  return (
    <Section number={4} title="Grants, Consultancy & IP">
      <div className="space-y-2">
        <SubLabel>Funded Projects</SubLabel>
        {(p.fundedProjects ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          <div className="space-y-2">
            {p.fundedProjects?.map((proj, i) => (
              <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Field label="Title" value={proj.title} />
                <Field label="Funding Agency" value={proj.fundingAgency} />
                <Field label="Grant Amount (₹L)" value={proj.grantAmountLakhs} />
                <Field label="Year" value={proj.year} />
                <Field label="Status" value={proj.status} />
                <Field label="Role" value={proj.piOrCoPi === "CO_PI" ? "Co-PI" : proj.piOrCoPi} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <SubLabel>Industry Consultancy</SubLabel>
        {(p.consultancyProjects ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          <div className="space-y-2">
            {p.consultancyProjects?.map((proj, i) => (
              <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Field label="Title" value={proj.title} />
                <Field label="Client / Agency" value={proj.clientOrAgency} />
                <Field label="Revenue (₹L)" value={proj.revenueLakhs} />
                <Field label="Year" value={proj.year} />
                <Field label="Status" value={proj.status} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-lg border bg-muted/20 shadow-sm p-3 space-y-2">
        <SubLabel>Patents</SubLabel>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Indian - Filed" value={patents?.indianFiled} />
          <Field label="Indian - Published" value={patents?.indianPublished} />
          <Field label="Indian - Granted" value={patents?.indianGranted} />
          <Field label="Intl - Filed" value={patents?.internationalFiled} />
          <Field label="Intl - Published" value={patents?.internationalPublished} />
          <Field label="Intl - Granted" value={patents?.internationalGranted} />
        </div>
        <Field label="Details" value={patents?.details} />
      </div>
    </Section>
  );
}

export function MentorshipModule({
  profile, ownerName,
}: {
  profile: Partial<FacultyProfileFields> | undefined;
  // This profile's own display name - fallback for entry #1 in a "Conducted"
  // training entry's Co-Conducting Faculty list when its stored `organizer`
  // is blank (a record saved before TrainingEntryFields started keeping that
  // field reliably in sync - see its own doc-comment). Omitted entirely
  // falls back further to "-".
  ownerName?: string;
}) {
  const p = profile ?? {};
  return (
    <Section number={5} title="Mentorship & Institutional Value">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
          <SubLabel>Ph.D. Scholars Pursuing</SubLabel>
          <div className="mt-2">
            <Field label="Count" value={p.phdScholarsPursuing?.count} />
            <Field label="University Names" value={p.phdScholarsPursuing?.universities} />
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
          <SubLabel>Ph.D. Scholars Awarded</SubLabel>
          <div className="mt-2">
            <Field label="Count" value={p.phdScholarsAwarded?.count} />
            <Field label="University Names" value={p.phdScholarsAwarded?.universities} />
          </div>
        </div>
      </div>
      <Field label="National Exposure" value={p.nationalExposure} />
      <Field label="International Exposure" value={p.internationalExposure} />
      <div className="space-y-2">
        <SubLabel>New Labs Established</SubLabel>
        {(p.labsEstablished ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.labsEstablished?.map((lab, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Field label="Facility Details" value={lab.facilityDetails} />
              <Field label="Outcomes" value={lab.outcomes} />
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>Academic Responsibilities</SubLabel>
        {(p.adminResponsibilityEntries ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.adminResponsibilityEntries?.map((r, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Category" value={r.category === "OTHER" ? r.otherCategory : ADMIN_RESPONSIBILITY_CATEGORY_LABELS[r.category]} />
              <Field label="Description" value={r.description} />
              <Field label="From" value={formatInstitutionDate(r.fromDate, r.fromYear)} />
              <Field label="To" value={formatInstitutionDate(r.toDate, r.toYear) ?? "Ongoing"} />
            </div>
          ))
        )}
        {p.administrativeResponsibilities && (
          <p className="text-xs text-muted-foreground italic">Legacy note: {p.administrativeResponsibilities}</p>
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>FDPs, Workshops, MOOCs &amp; Certifications</SubLabel>
        {(p.trainingEntries ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.trainingEntries?.map((t, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Type" value={TRAINING_ENTRY_TYPE_LABELS[t.type]} />
              <Field label="Participated or Conducted" value={t.role ? TRAINING_PARTICIPATION_ROLE_LABELS[t.role] : undefined} />
              <Field label="Title of the Program" value={t.title} />
              <Field label="Name of the Faculty / Coordinator" value={t.organizer} />
              <Field label="From Date" value={t.fromDate} />
              <Field label="To Date" value={t.toDate} />
              <Field label="Duration" value={t.durationDays ? `${t.durationDays} day${t.durationDays === 1 ? "" : "s"}` : undefined} />
              <Field label="National / International" value={t.levelOfProgram ? TRAINING_PROGRAM_LEVEL_LABELS[t.levelOfProgram] : undefined} />
              <Field label="Place" value={t.place} />
              <Field label="Mode of the Program" value={t.mode ? TRAINING_PROGRAM_MODE_LABELS[t.mode] : undefined} />
              <Field label="Beneficiaries" value={beneficiarySummary(t)} />
              <Field label="Number of Resource Persons" value={t.numberOfResourcePersons} />
              <Field
                label="Resource Persons - Details"
                value={(() => {
                  const list = normalizeResourcePersonsDetails(t.resourcePersonsDetails);
                  return list.length > 0 ? list.map((d, i) => `${i + 1}. ${d}`).join(", ") : undefined;
                })()}
              />
              {!t.fromDate && t.year && <Field label="Year (legacy)" value={t.year} />}
              {(t.coConductors ?? []).length > 0 && (
                <Field
                  label="Co-Conducting Faculty"
                  value={[
                    // A record saved before TrainingEntryFields started
                    // keeping `organizer` reliably in sync can have it blank
                    // on its own master copy - fall back to this profile's
                    // own name there (a synced copy's organizer is always
                    // populated, copied over at sync time, so this only ever
                    // matters for !t.isCoConductedCopy).
                    `1. ${t.organizer || (!t.isCoConductedCopy && ownerName) || "-"}`,
                    ...t.coConductors!.map((c) => `${c.order}. ${c.name} (${c.department})`),
                  ].join(", ")}
                />
              )}
              {t.role === "PARTICIPATED" && <Field label="Remark" value={t.remark} />}
              <Field label="Other Details" value={t.otherDetails} />
              {t.certificateUrl && (
                <div className="col-span-2 sm:col-span-4"><DocLink url={t.certificateUrl} label="View Certificate" /></div>
              )}
            </div>
          ))
        )}
        {p.certificationsAndFdps && (
          <p className="text-xs text-muted-foreground italic">Legacy note: {p.certificationsAndFdps}</p>
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>Professional Body Memberships</SubLabel>
        {(p.professionalMemberships ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.professionalMemberships?.map((m, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Field label="Body" value={m.body === "OTHER" ? m.otherName : PROFESSIONAL_BODY_LABELS[m.body]} />
              <Field label="Membership ID" value={m.membershipId} />
              <Field label="Member Since (Month/Year)" value={m.sinceMonthYear ?? (m.sinceYear ? String(m.sinceYear) : undefined)} />
            </div>
          ))
        )}
        {p.professionalBodyMemberships && (
          <p className="text-xs text-muted-foreground italic">Legacy note: {p.professionalBodyMemberships}</p>
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>Authored Books</SubLabel>
        {(p.authoredBooks ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.authoredBooks?.map((b, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Field label="Title" value={b.title} />
              <Field label="Publisher" value={b.publisher} />
              <Field label="Year" value={b.year} />
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>Awards &amp; Recognition</SubLabel>
        {(p.awardEntries ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.awardEntries?.map((a, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Category" value={AWARD_CATEGORY_LABELS[a.category]} />
              <Field label="Title" value={a.title} />
              <Field label="Awarding Body" value={a.awardingBody} />
              <Field label="Year" value={a.year} />
              <Field label="State / National / International" value={a.level ? AWARD_LEVEL_LABELS[a.level] : undefined} />
              {a.certificateUrl && (
                <div className="col-span-2 sm:col-span-4"><DocLink url={a.certificateUrl} label="View Certificate" /></div>
              )}
            </div>
          ))
        )}
        {p.notableAwards && (
          <p className="text-xs text-muted-foreground italic">Legacy note: {p.notableAwards}</p>
        )}
      </div>
    </Section>
  );
}

export function FinancialModule({ profile }: { profile: Partial<FacultyProfileFields> | undefined }) {
  const p = profile ?? {};
  return (
    <Section number={6} title="Financial Standing & Budgetary Impact">
      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <SubLabel>Current Financial Standing</SubLabel>
        <div className="mt-2">
          <Field label="Monthly Salary (₹)" value={p.presentSalary} />
        </div>
      </div>
      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <SubLabel>Budgetary Impact</SubLabel>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Gross Annual CTC (₹)" value={p.grossAnnualCTC} />
          <Field label="Increments Awarded" value={p.incrementsAwarded} />
          <Field label="Funding/Consultancy Revenue Generation (₹)" value={p.fundingConsultancyRevenue} />
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
      <GrantsModule profile={profile} />
      <MentorshipModule profile={profile} />
      {!hideFinancialModule && <FinancialModule profile={profile} />}
      <OthersModule profile={profile} />
    </div>
  );
}
