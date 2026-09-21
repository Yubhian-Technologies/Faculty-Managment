"use client";

import { Manrope } from "next/font/google";
import { Avatar } from "@/components/shared/Avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { VISHNU_LOGO_URL } from "@/lib/pdf/logo";
import {
  Mail, MapPin, Share2, ExternalLink, GraduationCap, Microscope, Briefcase,
  FlaskConical, Award, Users, Info,
} from "lucide-react";
import { DESIGNATION_LABELS } from "@/types";
import { publicPeriod, publicYear } from "@/lib/faculty/publicProfileDates";
import type {
  Designation, TrainingEntryType, ProfessionalBody, AdminResponsibilityCategory, TrainingProgramMode,
} from "@/types";
import {
  TRAINING_ENTRY_TYPE_LABELS, PROFESSIONAL_BODY_LABELS, ADMIN_RESPONSIBILITY_CATEGORY_LABELS, TRAINING_PROGRAM_MODE_LABELS,
} from "@/types";

// Deliberately distinct from the app's own Inter (see app/layout.tsx) - this
// no-auth public page is a standalone "directory profile" surface, not a
// dashboard screen, so it earns its own type identity rather than
// inheriting the app's.
const bodyFont = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export interface DegreeSummary {
  course: string;
  degreeType?: string;
  branch: string;
  specialization?: string;
  institutionName: string;
  // Exactly one is set: yearOfAward for Doctoral/Post-Doctoral entries,
  // yearOfPassing for everything else (see publicDegree in the public API route).
  yearOfPassing?: number;
  yearOfAward?: number;
}

export interface FacultyPublicProfile {
  collegeName: string;
  name: string;
  designation: Designation;
  department: string;
  profilePhotoUrl?: string;
  highestQualification: string;
  specialization?: string;
  totalYearsOfExperience: number;
  officialEmail?: string;
  joiningYear?: number;
  education?: {
    highestQualification: string;
    ugDetails?: DegreeSummary;
    additionalUgDetails: (DegreeSummary | undefined)[];
    pgDetails?: DegreeSummary;
    additionalPgDetails: (DegreeSummary | undefined)[];
    phdDetails?: DegreeSummary;
    additionalPhdDetails: (DegreeSummary | undefined)[];
    postdoctoralFellowshipDetails?: DegreeSummary;
    phdStatus?: "AWARDED" | "PURSUING";
    netSletSetGateOthers?: "YES" | "NO";
    qualifiedExam?: string;
    qualifiedYear?: number;
  };
  // fromDate/toDate are the real dates the current forms write; fromYear/toYear
  // are the legacy year-only fallback (see publicProfileDates.ts).
  academicExperience: { institutionName: string; designation?: string; fromDate?: string; toDate?: string; fromYear?: number; toYear?: number }[];
  research?: {
    publications: { title: string; coAuthors: string; journalOrConference: string; publicationYear: number; indexing?: string }[];
    totalPublications: number;
    totalCitations: number;
    hIndex: number;
    i10Index: number;
    googleScholarId?: string;
    scopusAuthorId?: string;
    orcidId?: string;
  };
  recognition?: {
    awardsRecognition: { titleOfAward: string; awardingAgencyBody: string; dateOfAward?: string; year?: number }[];
    professionalMemberships: { body: ProfessionalBody; bodyName?: string; memberSince?: string; sinceMonthYear?: string; sinceYear?: number }[];
    academicResponsibilities: { category: AdminResponsibilityCategory; otherCategory?: string; description: string; fromDate?: string; toDate?: string; fromYear?: number; toYear?: number }[];
    newLabsEstablished: { facilityDetails: string; outcomes: string }[];
    fdpsWorkshopsMoocsCertifications: {
      type: TrainingEntryType; pleaseSpecifyType?: string; titleOfTheProgram: string; nameOfTheFacultyCoordinator?: string;
      fromDate?: string; toDate?: string; year?: number; duration?: number; numberOfWeeks?: number; place?: string; modeOfTheProgram?: TrainingProgramMode;
    }[];
  };
  otherInformation?: string;
}

// Bold "what": course/degree + field. Secondary "where/when": institution + year.
function degreeTitle(d?: DegreeSummary) {
  if (!d) return null;
  const course = d.course && d.degreeType ? `${d.course} (${d.degreeType})` : d.course;
  return [course, d.specialization || d.branch].filter(Boolean).join(", ");
}
function degreeMeta(d?: DegreeSummary) {
  if (!d) return null;
  const year = d.yearOfAward ?? d.yearOfPassing;
  return [d.institutionName, year].filter(Boolean).join(" · ");
}

function Card({ title, icon: Icon, badge, children }: { title: string; icon: React.ComponentType<{ className?: string }>; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <Icon className="h-5 w-5 text-primary shrink-0" />
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

// title = the one or two facts that matter most for this entry type (bold);
// meta = everything else, shown as a lighter secondary line underneath.
function EntryCard({ title, meta, children }: { title?: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3.5 text-base transition-colors hover:bg-muted/50">
      {title !== undefined ? (
        <>
          <p className="font-semibold text-foreground">{title}</p>
          {meta !== undefined && meta !== "" && <p className="text-sm text-muted-foreground mt-1">{meta}</p>}
        </>
      ) : (
        children
      )}
    </div>
  );
}

// Small circular "logo" badge for a research-profile service - a plain
// colored monogram rather than a hotlinked brand asset, but instantly
// recognizable by its color/glyph (Scholar's cap, ORCID's green "iD", Scopus's "S").
function ResearchProfileBadge({ service }: { service: "scholar" | "orcid" | "scopus" }) {
  if (service === "scholar") {
    return (
      <div className="h-9 w-9 rounded-full bg-[#4285F4] flex items-center justify-center shrink-0">
        <GraduationCap className="h-4 w-4 text-white" />
      </div>
    );
  }
  if (service === "orcid") {
    return (
      <div className="h-9 w-9 rounded-full bg-[#A6CE39] flex items-center justify-center text-white text-xs font-bold shrink-0">
        iD
      </div>
    );
  }
  return (
    <div className="h-9 w-9 rounded-full bg-[#E9711C] flex items-center justify-center text-white text-sm font-bold shrink-0">
      S
    </div>
  );
}

function EntryList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2.5">{children}</div>;
}

// Circular icon tile in the Awards & Recognition strip - the directory
// template's "badges" row, repurposed for real award entries instead of
// decorative achievement icons.
function BadgeTile({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center text-center w-32">
      <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
        <Award className="h-6 w-6 text-primary" />
      </div>
      <p className="mt-2 text-sm font-medium leading-tight line-clamp-2">{title}</p>
      {subtitle && <p className="text-xs text-muted-foreground line-clamp-1">{subtitle}</p>}
    </div>
  );
}

export function FacultyPublicProfileView({ profile }: { profile: FacultyPublicProfile }) {
  const p = profile;

  const degreeEntries = [
    ...(p.education?.phdDetails ? [{ label: "Ph.D.", d: p.education.phdDetails }] : []),
    ...(p.education?.additionalPhdDetails ?? []).filter((d): d is DegreeSummary => !!d).map((d) => ({ label: "Ph.D.", d })),
    ...(p.education?.pgDetails ? [{ label: "Post-Graduate", d: p.education.pgDetails }] : []),
    ...(p.education?.additionalPgDetails ?? []).filter((d): d is DegreeSummary => !!d).map((d) => ({ label: "Post-Graduate", d })),
    ...(p.education?.ugDetails ? [{ label: "Under-Graduate", d: p.education.ugDetails }] : []),
    ...(p.education?.additionalUgDetails ?? []).filter((d): d is DegreeSummary => !!d).map((d) => ({ label: "Under-Graduate", d })),
  ];

  const designationLabel = DESIGNATION_LABELS[p.designation] ?? p.designation;
  const qualBadges = [
    p.education?.netSletSetGateOthers === "YES" && p.education?.qualifiedExam &&
      `${p.education.qualifiedExam} Qualified${p.education.qualifiedYear ? ` (${p.education.qualifiedYear})` : ""}`,
    p.education?.phdStatus === "PURSUING" && "Ph.D. Pursuing",
  ].filter(Boolean) as string[];

  const hasResearchStats = p.research && (p.research.totalPublications || p.research.totalCitations || p.research.hIndex || p.research.i10Index);
  const scholarLinks = [
    p.research?.googleScholarId && { service: "scholar" as const, label: "Google Scholar", href: `https://scholar.google.com/citations?user=${p.research.googleScholarId}` },
    p.research?.scopusAuthorId && { service: "scopus" as const, label: "Scopus", href: `https://www.scopus.com/authid/detail.uri?authorId=${p.research.scopusAuthorId}` },
    p.research?.orcidId && { service: "orcid" as const, label: "ORCID", href: `https://orcid.org/${p.research.orcidId}` },
  ].filter((x): x is { service: "scholar" | "scopus" | "orcid"; label: string; href: string } => !!x);

  const showHighlights = !!p.highestQualification || !!p.specialization || qualBadges.length > 0;
  const showBio = !!p.otherInformation;
  const showEducation = degreeEntries.length > 0;
  const showPostdoc = !!p.education?.postdoctoralFellowshipDetails;
  const showExperience = p.academicExperience.length > 0;
  const showResearch = !!hasResearchStats || (p.research?.publications.length ?? 0) > 0;
  const showAwards = (p.recognition?.awardsRecognition.length ?? 0) > 0;
  const showEngagement = !!p.recognition && (
    p.recognition.professionalMemberships.length > 0 ||
    p.recognition.academicResponsibilities.length > 0 ||
    p.recognition.newLabsEstablished.length > 0 ||
    p.recognition.fdpsWorkshopsMoocsCertifications.length > 0
  );

  function copyProfileLink() {
    void navigator.clipboard.writeText(window.location.href);
    toast({ variant: "success", title: "Public profile link copied" });
  }

  const statCells: ({ value: React.ReactNode; label: string } | null)[] = [
    p.totalYearsOfExperience > 0 ? { value: `${p.totalYearsOfExperience}+`, label: "Years Experience" } : null,
    p.research && p.research.totalPublications > 0 ? { value: p.research.totalPublications, label: "Publications" } : null,
    p.research && p.research.totalCitations > 0 ? { value: p.research.totalCitations, label: "Citations" } : null,
    p.joiningYear ? { value: p.joiningYear, label: "Joined In" } : null,
  ];
  const visibleStatCells = statCells.filter((c): c is { value: React.ReactNode; label: string } => c !== null);

  return (
    <div className={`${bodyFont.className} min-h-screen bg-background`}>
      {/* Hero: single-column, no sidebar - photo + identity on a soft band,
          topped by the college letterhead and closed off by a stats strip. */}
      <div className="bg-primary/5">
        <div className="max-w-5xl mx-auto px-5 sm:px-10 pt-6">
          <div className="flex items-center justify-center gap-3 pb-6">
            <img src={VISHNU_LOGO_URL} alt="Vishnu Logo" className="h-8 w-8 object-contain shrink-0" />
            <p className="font-semibold tracking-wide text-primary text-sm text-center">SHRI VISHNU EDUCATIONAL SOCIETY</p>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-5 sm:px-10 pb-8 lg:pb-12 flex flex-col sm:flex-row sm:items-start gap-6 lg:gap-8">
          <Avatar
            name={p.name}
            photoUrl={p.profilePhotoUrl}
            size="xl"
            className="ring-4 ring-background shadow-lg shrink-0 lg:h-40 lg:w-40 lg:text-5xl"
          />
          <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl sm:text-4xl lg:text-6xl font-extrabold text-foreground">{p.name}</h1>
              <p className="text-base lg:text-xl text-muted-foreground mt-1.5 lg:mt-3">
                {designationLabel} at <span className="font-semibold text-foreground">{p.department}</span>
              </p>
              {p.collegeName && (
                <p className="flex items-center gap-1.5 text-sm lg:text-base text-muted-foreground mt-1">
                  <MapPin className="h-3.5 w-3.5" />{p.collegeName}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={copyProfileLink}
                aria-label="Copy public profile link"
                title="Copy public profile link"
                className="inline-flex items-center justify-center rounded-full border bg-background h-9 w-9 hover:bg-muted transition-colors"
              >
                <Share2 className="h-4 w-4" />
              </button>
              {p.officialEmail && (
                <Button asChild variant="outline" size="sm">
                  <a href={`mailto:${p.officialEmail}`}><Mail className="h-3.5 w-3.5 mr-1.5" />Send Email</a>
                </Button>
              )}
            </div>
          </div>
        </div>

        {visibleStatCells.length > 0 && (
          <div className="border-t bg-background">
            <div className="max-w-5xl mx-auto px-5 sm:px-10 flex flex-wrap">
              {visibleStatCells.map((c, i) => (
                <div key={i} className="flex-1 min-w-[7rem] flex flex-col items-center justify-center py-5 border-r last:border-r-0 border-border">
                  <p className="text-2xl font-bold text-foreground">{c.value}</p>
                  <p className="text-sm text-muted-foreground">{c.label}</p>
                </div>
              ))}
              <button
                type="button"
                onClick={copyProfileLink}
                className="flex-1 min-w-[9rem] flex items-center justify-center gap-2 py-5 bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
              >
                <Share2 className="h-4 w-4" />Share Profile
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-5 sm:px-10 py-8 space-y-6">
        {showHighlights && (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-semibold text-muted-foreground">Highlights:</span>
            {p.highestQualification && <Badge>{p.highestQualification}</Badge>}
            {p.specialization && <Badge variant="outline">{p.specialization}</Badge>}
            {qualBadges.map((b) => <Badge key={b} variant="outline">{b}</Badge>)}
          </div>
        )}

        {(showBio || scholarLinks.length > 0) && (
          <div className="flex flex-col lg:flex-row gap-6">
            {showBio && (
              <div className="lg:basis-2/3">
                <Card
                  title="Professional Bio"
                  icon={Info}
                  badge={p.totalYearsOfExperience > 0 ? <Badge variant="outline">{p.totalYearsOfExperience}+ years experience</Badge> : undefined}
                >
                  <p className="text-base leading-relaxed whitespace-pre-wrap">{p.otherInformation}</p>
                </Card>
              </div>
            )}
            {scholarLinks.length > 0 && (
              <div className="lg:basis-1/3">
                <Card title="Research Profiles" icon={FlaskConical}>
                  <div className="space-y-3">
                    {scholarLinks.map((l) => (
                      <a
                        key={l.label}
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 hover:bg-muted/50 transition-colors"
                      >
                        <ResearchProfileBadge service={l.service} />
                        <span className="flex-1 min-w-0 text-sm font-medium truncate">{l.label}</span>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </a>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}

        {showEducation && (
          <Card title="Educational Details" icon={GraduationCap}>
            <EntryList>
              {degreeEntries.map((e, i) => (
                <EntryCard key={i} title={`${e.label}: ${degreeTitle(e.d)}`} meta={degreeMeta(e.d)} />
              ))}
            </EntryList>
          </Card>
        )}

        {showPostdoc && p.education?.postdoctoralFellowshipDetails && (
          <Card title="Post-Doctoral Experience" icon={Microscope}>
            <EntryCard title={degreeTitle(p.education.postdoctoralFellowshipDetails)} meta={degreeMeta(p.education.postdoctoralFellowshipDetails)} />
          </Card>
        )}

        {showExperience && (
          <Card title="Academic Experience" icon={Briefcase}>
            <EntryList>
              {p.academicExperience.map((inst, i) => {
                const period = publicPeriod(inst.fromDate, inst.toDate, inst.fromYear, inst.toYear);
                return (
                  <EntryCard key={i} title={inst.institutionName} meta={[inst.designation, period].filter(Boolean).join(" · ")} />
                );
              })}
            </EntryList>
          </Card>
        )}

        {showResearch && p.research && (
          <Card title="Research Details" icon={FlaskConical}>
            {(p.research.hIndex > 0 || p.research.i10Index > 0) && (
              <div className="flex flex-wrap gap-3 pb-5">
                {p.research.hIndex > 0 && (
                  <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center min-w-28">
                    <p className="text-2xl font-bold text-primary">{p.research.hIndex}</p>
                    <p className="text-sm text-muted-foreground">h-index</p>
                  </div>
                )}
                {p.research.i10Index > 0 && (
                  <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center min-w-28">
                    <p className="text-2xl font-bold text-primary">{p.research.i10Index}</p>
                    <p className="text-sm text-muted-foreground">i10-index</p>
                  </div>
                )}
              </div>
            )}
            {p.research.publications.length > 0 && (
              <EntryList>
                {p.research.publications.map((pub, i) => (
                  <EntryCard key={i}>
                    <p className="font-medium">{pub.title}</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      {pub.coAuthors && `${pub.coAuthors} — `}{pub.journalOrConference} ({pub.publicationYear})
                      {pub.indexing && <Badge variant="outline" className="ml-1.5 text-xs">{pub.indexing}</Badge>}
                    </p>
                  </EntryCard>
                ))}
              </EntryList>
            )}
          </Card>
        )}

        {showAwards && p.recognition && (
          <div className="rounded-lg border bg-background p-6">
            <div className="flex items-center justify-center gap-2.5 mb-6">
              <Award className="h-5 w-5 text-primary shrink-0" />
              <h2 className="text-lg font-bold text-foreground">Awards &amp; Recognition ({p.recognition.awardsRecognition.length})</h2>
            </div>
            <div className="flex flex-wrap justify-center gap-6">
              {p.recognition.awardsRecognition.map((a, i) => (
                <BadgeTile key={i} title={a.titleOfAward} subtitle={[a.awardingAgencyBody, publicYear(a.dateOfAward, a.year)].filter(Boolean).join(" · ")} />
              ))}
            </div>
          </div>
        )}

        {showEngagement && p.recognition && (
          <Card title="Professional Engagement" icon={Users}>
            <div className="space-y-6">
              {p.recognition.academicResponsibilities.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Academic Responsibilities</p>
                  <EntryList>
                    {p.recognition.academicResponsibilities.map((r, i) => {
                      const period = publicPeriod(r.fromDate, r.toDate, r.fromYear, r.toYear);
                      const label = r.category === "OTHER" ? (r.otherCategory || "Other") : (ADMIN_RESPONSIBILITY_CATEGORY_LABELS[r.category] ?? r.category);
                      return (
                        <EntryCard key={i} title={label} meta={[r.description, period].filter(Boolean).join(" · ")} />
                      );
                    })}
                  </EntryList>
                </div>
              )}
              {p.recognition.professionalMemberships.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Professional Memberships</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.recognition.professionalMemberships.map((m, i) => {
                      const since = publicYear(m.memberSince ?? m.sinceMonthYear, m.sinceYear);
                      return (
                        <Badge key={i} variant="outline">
                          {m.body === "OTHER" ? m.bodyName : PROFESSIONAL_BODY_LABELS[m.body]}
                          {since ? ` (since ${since})` : ""}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
              {p.recognition.fdpsWorkshopsMoocsCertifications.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">FDPs, Workshops, MOOCs &amp; Certifications</p>
                  <EntryList>
                    {p.recognition.fdpsWorkshopsMoocsCertifications.map((t, i) => {
                      const year = publicYear(t.fromDate, t.year);
                      const duration = t.duration ? `${t.duration} day${t.duration === 1 ? "" : "s"}` : t.numberOfWeeks ? `${t.numberOfWeeks} week${t.numberOfWeeks === 1 ? "" : "s"}` : undefined;
                      const meta = [
                        t.type === "OTHER" ? (t.pleaseSpecifyType || "Other") : TRAINING_ENTRY_TYPE_LABELS[t.type],
                        t.nameOfTheFacultyCoordinator,
                        t.place,
                        t.modeOfTheProgram && TRAINING_PROGRAM_MODE_LABELS[t.modeOfTheProgram],
                        year,
                      ].filter(Boolean).join(" · ");
                      return (
                        <EntryCard
                          key={i}
                          title={
                            <span className="flex flex-wrap items-baseline gap-x-2">
                              {t.titleOfTheProgram}
                              {duration && <span className="text-primary font-bold">{duration}</span>}
                            </span>
                          }
                          meta={meta}
                        />
                      );
                    })}
                  </EntryList>
                </div>
              )}
              {p.recognition.newLabsEstablished.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">New Labs Established</p>
                  <EntryList>
                    {p.recognition.newLabsEstablished.map((l, i) => (
                      <EntryCard key={i} title={l.facilityDetails} meta={l.outcomes} />
                    ))}
                  </EntryList>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
