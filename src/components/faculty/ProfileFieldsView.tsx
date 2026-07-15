import type { FacultyProfileFields } from "@/types";

interface Props {
  profile: Partial<FacultyProfileFields> | undefined;
  includeTeachingAssignment?: boolean;
}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 pt-5 border-t first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {number}
        </span>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      {children}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{children}</p>;
}

function Field({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value === undefined || value === null || value === "" ? "—" : value}</p>
    </div>
  );
}

function DegreeView({ label, degree }: { label: string; degree: FacultyProfileFields["ugDetails"] }) {
  return (
    <div className="rounded-lg border bg-muted/20 shadow-sm p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <p className="col-span-2 sm:col-span-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <Field label="Degree & Branch" value={degree?.degreeAndBranch} />
      <Field label="University / Institute" value={degree?.universityOrInstitute} />
      <Field label="Percentage / Division" value={degree?.percentageOrDivision} />
      <Field label="Year of Completion" value={degree?.yearOfCompletion} />
    </div>
  );
}

export function ProfileFieldsView({ profile, includeTeachingAssignment = true }: Props) {
  const p = profile ?? {};
  const teaching = p.teachingAssignment;
  const patents = p.patents;

  return (
    <div className="space-y-5">
      <Section number={1} title="General & Academic Profile">
        <Field label="Highest Qualification Earned" value={p.highestQualification} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <DegreeView label="UG" degree={p.ugDetails} />
          <DegreeView label="PG" degree={p.pgDetails} />
          <DegreeView label="PhD" degree={p.phdDetails} />
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

      <Section number={2} title="Tenure & Load">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Teaching Exp Before Joining (yrs)" value={p.teachingExperienceBeforeJoiningYears} />
          <Field label="Teaching Exp Since Joining (yrs)" value={p.teachingExperienceSinceJoiningYears} />
          <Field label="Research/Industry Exp (yrs)" value={p.researchOrIndustryExperienceYears} />
          <Field label="Total Professional Exp (yrs)" value={p.totalProfessionalExperienceYears} />
          <Field label="Weekly Teaching Load (Hrs)" value={p.totalWeeklyTeachingLoadHours} />
          <Field label="Avg Student Feedback Score" value={p.averageStudentFeedbackScore} />
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
                    <p className="text-sm font-medium">{c.code} — {c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.weeklyCreditHours} hrs/week</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section number={3} title="Research Publications">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="First/Corresponding Author" value={p.publicationsFirstOrCorrespondingAuthor} />
          <Field label="Q1 / IF>4.0" value={p.publicationsQ1OrHighImpact} />
          <Field label="SCI/Scopus" value={p.sciScopusCount} />
          <Field label="WoS (SCIE/ESCI)" value={p.wosCount} />
          <Field label="Conference Papers" value={p.conferencePapersCount} />
          <Field label="Book Chapters" value={p.bookChaptersCount} />
          <Field label="Review Publications" value={p.reviewPublicationsCount} />
          <Field label="Total Publications" value={p.totalPublications} />
          <Field label="Total Citations" value={p.totalCitations} />
          <Field label="H-Index" value={p.hIndex} />
          <Field label="i10-Index" value={p.i10Index} />
        </div>
      </Section>

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
            <Field label="Indian — Filed" value={patents?.indianFiled} />
            <Field label="Indian — Published" value={patents?.indianPublished} />
            <Field label="Indian — Granted" value={patents?.indianGranted} />
            <Field label="Intl — Filed" value={patents?.internationalFiled} />
            <Field label="Intl — Published" value={patents?.internationalPublished} />
            <Field label="Intl — Granted" value={patents?.internationalGranted} />
          </div>
          <Field label="Details" value={patents?.details} />
        </div>
      </Section>

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
        <Field label="Administrative Responsibilities Held" value={p.administrativeResponsibilities} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Certifications / FDPs" value={p.certificationsAndFdps} />
          <Field label="Professional Body Memberships" value={p.professionalBodyMemberships} />
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
        <Field label="Notable Awards" value={p.notableAwards} />
      </Section>

      <Section number={6} title="Others">
        <p className="text-sm whitespace-pre-wrap">{p.otherInformation || "—"}</p>
      </Section>
    </div>
  );
}
