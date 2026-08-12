"use client";

import {
  Section, SubLabel, Field, DegreeView, DocLink, QualificationsView,
} from "@/components/shared/ProfileFieldPrimitives";
import { designationLabel } from "@/lib/designations/config";
import { PublicationsSection } from "@/components/faculty/PublicationsModuleView";
import {
  TRAINING_ENTRY_TYPE_LABELS, PROFESSIONAL_BODY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS,
} from "@/types";
import type { FacultyProfileFields, CollegeType, ResearchPublication } from "@/types";

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
        <Field label="Highest Qualification Earned" value={p.highestQualification} />
        <QualificationsView items={p.schoolQualifications} />
      </Section>
    );
  }
  return (
    <Section number={1} title="General & Academic Profile">
      <Field label="Highest Qualification Earned" value={p.highestQualification} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DegreeView label="High School (10th)" degree={p.highSchoolDetails} />
        <DegreeView label="Intermediate (12th)" degree={p.intermediateDetails} />
        <DegreeView label="UG" degree={p.ugDetails} />
        <DegreeView label="PG" degree={p.pgDetails} />
        {(p.additionalPgDetails ?? []).map((d, i) => <DegreeView key={`pg-${i}`} label={`PG ${i + 2}`} degree={d} />)}
        <DegreeView label="PhD" degree={p.phdDetails} level="DOCTORAL" />
        {(p.additionalPhdDetails ?? []).map((d, i) => <DegreeView key={`phd-${i}`} label={`PhD ${i + 2}`} degree={d} level="DOCTORAL" />)}
        <DegreeView label="Post-Doctoral" degree={p.postDoctoralDetails} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label="Ph.D. Status" value={p.phdStatus} />
        <Field label="Ph.D. Mode" value={p.phdMode} />
        <Field label="Supervisor" value={p.phdSupervisorName} />
        <Field label="Fellowships" value={p.fellowshipsReceived} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="GATE Qualified Year" value={p.gateQualifiedYear} />
        <Field label="GATE Score" value={p.gateScore} />
        <Field label="NET/SLET Year" value={p.netSletQualificationYear} />
      </div>
    </Section>
  );
}

export function ExperienceModule({ profile, includeTeachingAssignment = true }: { profile: Partial<FacultyProfileFields> | undefined; includeTeachingAssignment?: boolean }) {
  const p = profile ?? {};
  const teaching = p.teachingAssignment;
  return (
    <Section number={2} title="Previous Experience">
      <div className="space-y-2">
        <SubLabel>Previous Institutions Worked At</SubLabel>
        {(p.previousInstitutions ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          <div className="space-y-2">
            {p.previousInstitutions?.map((inst, i) => (
              <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Field label="Institution" value={inst.institutionName} />
                <Field label="Designation" value={inst.designation} />
                <Field label="From Year" value={inst.fromYear} />
                <Field label="To Year" value={inst.toYear} />
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
        <SubLabel>Promotion History</SubLabel>
        {(p.promotionHistory ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          <div className="space-y-2">
            {p.promotionHistory?.map((promo, i) => (
              <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {/* Now stored as catalogue codes (ASSISTANT_PROFESSOR, …) since
                    these became dropdowns - labelled here so the view doesn't
                    show the raw code. Free text from older records and from
                    "Other" passes through designationLabel unchanged. */}
                <Field label="From" value={designationLabel(promo.fromDesignation)} />
                <Field label="To" value={designationLabel(promo.toDesignation)} />
                <Field label="Effective Year" value={promo.effectiveYear} />
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
                <Field label="Agency" value={proj.fundingAgency} />
                <Field label="Grant (₹L)" value={proj.grantAmountLakhs} />
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
                <Field label="Client/Agency" value={proj.clientOrAgency} />
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

export function MentorshipModule({ profile }: { profile: Partial<FacultyProfileFields> | undefined }) {
  const p = profile ?? {};
  return (
    <Section number={5} title="Mentorship & Institutional Value">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
          <SubLabel>Ph.D. Scholars Pursuing</SubLabel>
          <div className="mt-2">
            <Field label="Count" value={p.phdScholarsPursuing?.count} />
            <Field label="Universities" value={p.phdScholarsPursuing?.universities} />
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
          <SubLabel>Ph.D. Scholars Awarded</SubLabel>
          <div className="mt-2">
            <Field label="Count" value={p.phdScholarsAwarded?.count} />
            <Field label="Universities" value={p.phdScholarsAwarded?.universities} />
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
        <SubLabel>Administrative Responsibilities</SubLabel>
        {(p.adminResponsibilityEntries ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.adminResponsibilityEntries?.map((r, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Category" value={ADMIN_RESPONSIBILITY_CATEGORY_LABELS[r.category]} />
              <Field label="Description" value={r.description} />
              <Field label="From" value={r.fromYear} />
              <Field label="To" value={r.toYear ?? "Ongoing"} />
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
              <Field label="Title" value={t.title} />
              <Field label="Organizer" value={t.organizer} />
              <Field label="Year" value={t.year} />
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
              <Field label="Since" value={m.sinceYear} />
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
          <Field label="Present Salary (₹)" value={p.presentSalary} />
        </div>
      </div>
      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <SubLabel>Budgetary Impact</SubLabel>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Gross Annual CTC (₹)" value={p.grossAnnualCTC} />
          <Field label="Increments Awarded" value={p.incrementsAwarded} />
          <Field label="Funding/Consultancy Revenue (₹)" value={p.fundingConsultancyRevenue} />
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
      <GrantsModule profile={profile} />
      <MentorshipModule profile={profile} />
      {!hideFinancialModule && <FinancialModule profile={profile} />}
      <OthersModule profile={profile} />
    </div>
  );
}
