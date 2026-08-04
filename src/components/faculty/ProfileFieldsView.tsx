"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  Section, SubLabel, Field, DegreeView, DocLink,
} from "@/components/shared/ProfileFieldPrimitives";
import {
  TRAINING_ENTRY_TYPE_LABELS, PROFESSIONAL_BODY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS,
} from "@/types";
import type { FacultyProfileFields } from "@/types";

interface Props {
  profile: Partial<FacultyProfileFields> | undefined;
  includeTeachingAssignment?: boolean;
  hideFinancialModule?: boolean;
}

const PUBS_PREVIEW = 3;

function PublicationsList({ publications }: { publications: NonNullable<FacultyProfileFields["publications"]> }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...publications].sort((a, b) => (b.publicationYear ?? 0) - (a.publicationYear ?? 0));
  const visible = expanded ? sorted : sorted.slice(0, PUBS_PREVIEW);
  const hidden = sorted.length - PUBS_PREVIEW;

  return (
    <div className="space-y-2">
      {visible.map((pub, i) => (
        <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Field label="Title" value={pub.title} />
          <Field label="Co-Authors" value={pub.coAuthors} />
          <Field label="Journal / Conference" value={pub.journalOrConference} />
          <Field label="Year" value={pub.publicationYear} />
          <Field label="Indexing" value={pub.indexing} />
          {pub.driveLink && (
            <div className="col-span-2 sm:col-span-5">
              <a
                href={pub.driveLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />View Publication
              </a>
            </div>
          )}
        </div>
      ))}
      {sorted.length > PUBS_PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium text-primary hover:underline mt-1"
        >
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}

export function ProfileFieldsView({ profile, includeTeachingAssignment = true, hideFinancialModule = false }: Props) {
  const p = profile ?? {};
  const teaching = p.teachingAssignment;
  const patents = p.patents;

  return (
    <div className="space-y-5">
      <Section number={1} title="General & Academic Profile">
        <Field label="Highest Qualification Earned" value={p.highestQualification} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DegreeView label="UG" degree={p.ugDetails} />
          <DegreeView label="PG" degree={p.pgDetails} />
          <DegreeView label="PhD" degree={p.phdDetails} />
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

      <Section number={2} title="Previous Experience">
        <div className="space-y-2">
          <SubLabel>Previous Institutions Worked At</SubLabel>
          {(p.previousInstitutions ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
            <div className="space-y-2">
              {p.previousInstitutions?.map((inst, i) => (
                <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Field label="Institution" value={inst.institutionName} />
                  <Field label="Designation" value={inst.designation} />
                  <Field label="Years Worked" value={inst.yearsWorked} />
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
                  <Field label="From" value={promo.fromDesignation} />
                  <Field label="To" value={promo.toDesignation} />
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
        <div className="space-y-2">
          <SubLabel>Publications</SubLabel>
          {(p.publications ?? []).length === 0
            ? <p className="text-xs text-muted-foreground">None recorded.</p>
            : <PublicationsList publications={p.publications!} />
          }
        </div>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Google Scholar ID" value={p.googleScholarId} />
          <Field label="Scopus Author ID" value={p.scopusAuthorId} />
          <Field label="ORCID iD" value={p.orcidId} />
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

      {!hideFinancialModule && (
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
      )}

      <Section number={7} title="Others">
        <p className="text-sm whitespace-pre-wrap">{p.otherInformation || "—"}</p>
      </Section>

      <Section number={8} title="Teaching Documentation (NBA/AICTE)">
        <div className="space-y-2">
          <SubLabel>Course Files &amp; CO-PO Mapping</SubLabel>
          {(p.courseFilesAndCoPoMapping ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
            p.courseFilesAndCoPoMapping?.map((c, i) => (
              <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Field label="Course Code" value={c.courseCode} />
                <Field label="Course Name" value={c.courseName} />
                <Field label="Academic Year" value={c.academicYear} />
                <div className="col-span-2 sm:col-span-3 flex gap-4">
                  <DocLink url={c.courseFileUrl} label="View Course File" />
                  <DocLink url={c.coPoMappingUrl} label="View CO-PO Mapping" />
                </div>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}
