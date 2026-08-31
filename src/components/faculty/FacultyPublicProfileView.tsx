"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/shared/Avatar";
import { Badge } from "@/components/ui/badge";
import { VISHNU_LOGO_URL } from "@/lib/pdf/logo";
import {
  Mail, ExternalLink, UserRound, GraduationCap, Microscope, Briefcase,
  FlaskConical, BookOpen, Landmark, Handshake, Lightbulb, Award, Globe2,
  Users, Info,
} from "lucide-react";
import { DESIGNATION_LABELS } from "@/types";
import type {
  Designation, TrainingEntryType, ProfessionalBody, AdminResponsibilityCategory,
} from "@/types";
import {
  TRAINING_ENTRY_TYPE_LABELS, PROFESSIONAL_BODY_LABELS, ADMIN_RESPONSIBILITY_CATEGORY_LABELS,
} from "@/types";

export interface DegreeSummary {
  degree: string;
  branch: string;
  specialization?: string;
  universityOrInstitute: string;
  yearOfCompletion: number;
}

export interface FacultyPublicProfile {
  collegeName: string;
  name: string;
  designation: Designation;
  department: string;
  profilePhotoUrl?: string;
  qualification: string;
  specialization?: string;
  experienceYears: number;
  officialEmail?: string;
  joiningYear?: number;
  education?: {
    highestQualification: string;
    ugDetails?: DegreeSummary;
    pgDetails?: DegreeSummary;
    additionalPgDetails: (DegreeSummary | undefined)[];
    phdDetails?: DegreeSummary;
    additionalPhdDetails: (DegreeSummary | undefined)[];
    postDoctoralDetails?: DegreeSummary;
    phdStatus?: "AWARDED" | "PURSUING";
    netSletQualificationYear?: number;
    gateQualifiedYear?: number;
  };
  previousInstitutions: { institutionName: string; designation?: string; fromYear?: number; toYear?: number }[];
  research?: {
    publications: { title: string; coAuthors: string; journalOrConference: string; publicationYear: number; indexing?: string }[];
    totalPublications: number;
    totalCitations: number;
    hIndex: number;
    i10Index: number;
    googleScholarId?: string;
    scopusAuthorId?: string;
    orcidId?: string;
    authoredBooks: { title: string; publisher: string; year: number }[];
  };
  projects?: {
    fundedProjects: { title: string; fundingAgency: string; year: number; status: string; piOrCoPi?: "PI" | "CO_PI" }[];
    consultancyProjects: { title: string; clientOrAgency: string; year: number; status: string }[];
    patents?: { indianGranted: number; indianFiled: number; internationalGranted: number; internationalFiled: number };
  };
  recognition?: {
    awardEntries: { title: string; awardingBody: string; year: number }[];
    professionalMemberships: { body: ProfessionalBody; otherName?: string; sinceYear?: number }[];
    adminResponsibilityEntries: { category: AdminResponsibilityCategory; description: string; fromYear?: number; toYear?: number }[];
    labsEstablished: { facilityDetails: string; outcomes: string }[];
    trainingEntries: { type: TrainingEntryType; title: string; organizer: string; year: number }[];
    nationalExposure?: string;
    internationalExposure?: string;
  };
  otherInformation?: string;
}

function degreeLine(d?: DegreeSummary) {
  if (!d) return null;
  const parts = [d.degree, d.specialization || d.branch, d.universityOrInstitute].filter(Boolean);
  return `${parts.join(", ")}${d.yearOfCompletion ? ` (${d.yearOfCompletion})` : ""}`;
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b last:border-b-0">
      <span className="text-base text-muted-foreground">{label}</span>
      <span className="text-base font-medium text-right">{value}</span>
    </div>
  );
}

function SectionHeading({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      <Icon className="h-5 w-5 text-primary shrink-0" />
      <h2 className="text-xl font-bold text-foreground">{children}</h2>
    </div>
  );
}

function EntryCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3.5 text-base transition-colors hover:bg-muted/50">
      {children}
    </div>
  );
}

function EntryList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2.5">{children}</div>;
}

const SECTION_ICONS = {
  about: UserRound,
  education: GraduationCap,
  postdoc: Microscope,
  experience: Briefcase,
  research: FlaskConical,
  books: BookOpen,
  funded: Landmark,
  consultancy: Handshake,
  patents: Lightbulb,
  awards: Award,
  exposure: Globe2,
  engagement: Users,
  other: Info,
} as const;

// Section wrapper that registers itself with the parent's scrollspy observer
// (via id + the refCb callback) and gives smooth-scroll a landing target.
function SectionBlock({ id, refCb, children }: { id: string; refCb: (id: string, el: HTMLElement | null) => void; children: React.ReactNode }) {
  return (
    <section id={id} ref={(el) => refCb(id, el)} className="scroll-mt-6 py-8 first:pt-0 border-b last:border-b-0">
      {children}
    </section>
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
  ];

  const designationLabel = DESIGNATION_LABELS[p.designation] ?? p.designation;
  const qualBadges = [
    p.education?.netSletQualificationYear && `UGC-NET/SLET Qualified (${p.education.netSletQualificationYear})`,
    p.education?.gateQualifiedYear && `GATE Qualified (${p.education.gateQualifiedYear})`,
    p.education?.phdStatus === "PURSUING" && "Ph.D. Pursuing",
  ].filter(Boolean) as string[];

  const hasResearchStats = p.research && (p.research.totalPublications || p.research.totalCitations || p.research.hIndex || p.research.i10Index);
  const scholarLinks = [
    p.research?.googleScholarId && { label: "Google Scholar", href: `https://scholar.google.com/citations?user=${p.research.googleScholarId}` },
    p.research?.scopusAuthorId && { label: "Scopus", href: `https://www.scopus.com/authid/detail.uri?authorId=${p.research.scopusAuthorId}` },
    p.research?.orcidId && { label: "ORCID", href: `https://orcid.org/${p.research.orcidId}` },
  ].filter((x): x is { label: string; href: string } => !!x);

  const patents = p.projects?.patents;

  const showEducation = degreeEntries.length > 0 || qualBadges.length > 0;
  const showPostdoc = !!p.education?.postDoctoralDetails;
  const showExperience = p.previousInstitutions.length > 0;
  const showResearch = !!hasResearchStats || (p.research?.publications.length ?? 0) > 0 || scholarLinks.length > 0;
  const showBooks = (p.research?.authoredBooks.length ?? 0) > 0;
  const showFunded = (p.projects?.fundedProjects.length ?? 0) > 0;
  const showConsultancy = (p.projects?.consultancyProjects.length ?? 0) > 0;
  const showPatents = !!patents && !!(patents.indianGranted || patents.indianFiled || patents.internationalGranted || patents.internationalFiled);
  const showAwards = (p.recognition?.awardEntries.length ?? 0) > 0;
  const showExposure = !!(p.recognition?.nationalExposure || p.recognition?.internationalExposure);
  const showEngagement = !!p.recognition && (
    p.recognition.professionalMemberships.length > 0 ||
    p.recognition.adminResponsibilityEntries.length > 0 ||
    p.recognition.labsEstablished.length > 0 ||
    p.recognition.trainingEntries.length > 0
  );
  const showOther = !!p.otherInformation;

  const sections = [
    { key: "about", label: "About", show: true },
    { key: "education", label: "Educational Details", show: showEducation },
    { key: "postdoc", label: "Post-Doctoral Experience", show: showPostdoc },
    { key: "experience", label: "Prior Experience", show: showExperience },
    { key: "research", label: "Research Details", show: showResearch },
    { key: "books", label: "Books / Book Chapters Published", show: showBooks },
    { key: "funded", label: "Funded Projects", show: showFunded },
    { key: "consultancy", label: "Consultancy Projects", show: showConsultancy },
    { key: "patents", label: "Patents Published", show: showPatents },
    { key: "awards", label: "Awards & Recognitions", show: showAwards },
    { key: "exposure", label: "International Collaborations", show: showExposure },
    { key: "engagement", label: "Professional Engagement", show: showEngagement },
    { key: "other", label: "Other Information", show: showOther },
  ].filter((s) => s.show);

  const [activeKey, setActiveKey] = useState(sections[0]?.key ?? "about");
  const sectionEls = useRef(new Map<string, HTMLElement>());
  const mobileNavBtnEls = useRef(new Map<string, HTMLElement>());

  function registerSectionRef(id: string, el: HTMLElement | null) {
    if (el) sectionEls.current.set(id, el);
    else sectionEls.current.delete(id);
  }

  function registerMobileNavRef(id: string, el: HTMLElement | null) {
    if (el) mobileNavBtnEls.current.set(id, el);
    else mobileNavBtnEls.current.delete(id);
  }

  // The mobile pill nav scrolls horizontally and has more items than fit on
  // screen, so keep the active pill scrolled into view as it changes —
  // otherwise the highlighted item can silently scroll off to the right.
  useEffect(() => {
    mobileNavBtnEls.current.get(activeKey)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeKey]);

  // Scrollspy: highlight whichever section's top edge is nearest the top of
  // the viewport as the page scrolls, using a thin trigger band near the top
  // rather than "fully visible" so long sections still register correctly.
  useEffect(() => {
    const els = Array.from(sectionEls.current.entries());
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const id = topMost.target.id;
        if (id) setActiveKey(id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    for (const [, el] of els) observer.observe(el);
    return () => observer.disconnect();
  }, [sections.map((s) => s.key).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleNavClick(key: string) {
    setActiveKey(key);
    sectionEls.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-muted/30 to-primary/15 py-8 px-4 sm:px-8 animate-in fade-in duration-500">
      <div className="w-full space-y-4">
        <div className="flex items-center justify-center gap-4 rounded-2xl border-2 border-primary/20 bg-white/50 backdrop-blur-xl shadow-lg shadow-primary/5 py-5 px-6">
          <img
            src={VISHNU_LOGO_URL}
            alt="Vishnu Logo"
            className="h-12 w-12 sm:h-14 sm:w-14 object-contain shrink-0 drop-shadow-sm"
          />
          <div className="h-8 w-px bg-primary/15 hidden sm:block" />
          <p className="font-bold tracking-wide text-primary text-[clamp(1.125rem,3vw,1.75rem)] text-center">
            SHRI VISHNU EDUCATIONAL SOCIETY
          </p>
        </div>

        <div className="flex flex-col md:flex-row rounded-2xl border border-white/40 shadow-xl shadow-primary/5">
          <aside className="md:w-72 shrink-0 bg-gradient-to-b from-primary to-primary/90 text-primary-foreground rounded-t-2xl md:rounded-t-none md:rounded-l-2xl">
            <div className="flex flex-col items-center py-8 px-4 md:sticky md:top-4">
              <Avatar name={p.name} photoUrl={p.profilePhotoUrl} size="xl" className="ring-4 ring-white/30 shadow-xl bg-white text-primary" />
              <p className="mt-4 font-semibold text-center leading-tight px-2">{p.name}</p>
              <p className="text-sm text-primary-foreground/70 text-center mt-1">{designationLabel}</p>

              {/* Desktop: full vertical nav lives in the sticky sidebar itself */}
              <nav className="hidden md:flex md:flex-col gap-1 w-full mt-7">
                {sections.map((s) => {
                  const Icon = SECTION_ICONS[s.key as keyof typeof SECTION_ICONS];
                  const isActive = activeKey === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => handleNavClick(s.key)}
                      className={`group flex items-center gap-2.5 text-left text-sm px-3.5 py-2.5 rounded-lg transition-all duration-200 ${
                        isActive
                          ? "bg-white text-primary font-semibold shadow-md"
                          : "text-primary-foreground/75 hover:bg-white/10 hover:text-primary-foreground"
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? "text-primary" : "text-primary-foreground/60 group-hover:text-primary-foreground"}`} />
                      {s.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Mobile: a separate sticky pill bar so it stays pinned under the
              header while scrolling, instead of the whole avatar block. */}
          <nav className="md:hidden sticky top-0 z-10 flex flex-row gap-1 overflow-x-auto bg-primary/95 backdrop-blur-md px-3 py-2.5 border-b border-white/10">
            {sections.map((s) => {
              const Icon = SECTION_ICONS[s.key as keyof typeof SECTION_ICONS];
              const isActive = activeKey === s.key;
              return (
                <button
                  key={s.key}
                  ref={(el) => registerMobileNavRef(s.key, el)}
                  onClick={() => handleNavClick(s.key)}
                  className={`group flex items-center gap-1.5 shrink-0 text-left text-sm px-3 py-2 rounded-lg transition-all duration-200 whitespace-nowrap ${
                    isActive
                      ? "bg-white text-primary font-semibold shadow-md"
                      : "text-primary-foreground/75 hover:bg-white/10 hover:text-primary-foreground"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? "text-primary" : "text-primary-foreground/60 group-hover:text-primary-foreground"}`} />
                  {s.label}
                </button>
              );
            })}
          </nav>

          <div className="flex-1 bg-background rounded-b-2xl md:rounded-b-none md:rounded-r-2xl p-6 sm:p-10 min-w-0">
            <SectionBlock id="about" refCb={registerSectionRef}>
              <SectionHeading icon={SECTION_ICONS.about}>Profile Overview</SectionHeading>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 max-w-2xl">
                <InfoRow label="Designation" value={designationLabel} />
                <InfoRow label="Department" value={p.department} />
                <InfoRow label="Qualification" value={p.qualification} />
                <InfoRow label="Specialization" value={p.specialization} />
                <InfoRow label="Experience" value={p.experienceYears ? `${p.experienceYears}+ years` : undefined} />
                <InfoRow label="At the Institution Since" value={p.joiningYear} />
              </div>
              {qualBadges.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-4">
                  {qualBadges.map((b) => <Badge key={b} variant="outline">{b}</Badge>)}
                </div>
              )}
              {p.officialEmail && (
                <a href={`mailto:${p.officialEmail}`} className="inline-flex items-center gap-1.5 text-base text-primary hover:underline pt-4">
                  <Mail className="h-4 w-4" />{p.officialEmail}
                </a>
              )}
            </SectionBlock>

            {showEducation && (
              <SectionBlock id="education" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.education}>Educational Details</SectionHeading>
                <EntryList>
                  {degreeEntries.map((e, i) => (
                    <EntryCard key={i}>
                      <span className="font-medium">{e.label}:</span> {degreeLine(e.d)}
                    </EntryCard>
                  ))}
                </EntryList>
                {qualBadges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-3">
                    {qualBadges.map((b) => <Badge key={b} variant="outline">{b}</Badge>)}
                  </div>
                )}
              </SectionBlock>
            )}

            {showPostdoc && p.education?.postDoctoralDetails && (
              <SectionBlock id="postdoc" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.postdoc}>Post-Doctoral Experience</SectionHeading>
                <EntryCard>{degreeLine(p.education.postDoctoralDetails)}</EntryCard>
              </SectionBlock>
            )}

            {showExperience && (
              <SectionBlock id="experience" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.experience}>Prior Experience</SectionHeading>
                <EntryList>
                  {p.previousInstitutions.map((inst, i) => (
                    <EntryCard key={i}>
                      <span className="font-medium">{inst.institutionName}</span>
                      {inst.designation ? ` — ${inst.designation}` : ""}
                      {inst.fromYear && <span className="text-muted-foreground"> &middot; {inst.fromYear}–{inst.toYear ?? "present"}</span>}
                    </EntryCard>
                  ))}
                </EntryList>
              </SectionBlock>
            )}

            {showResearch && p.research && (
              <SectionBlock id="research" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.research}>Research Details</SectionHeading>
                {hasResearchStats && (
                  <div className="flex flex-wrap gap-3 pb-5">
                    {p.research.totalPublications > 0 && (
                      <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center min-w-[7rem]">
                        <p className="text-2xl font-bold text-primary">{p.research.totalPublications}</p>
                        <p className="text-sm text-muted-foreground">Publications</p>
                      </div>
                    )}
                    {p.research.totalCitations > 0 && (
                      <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center min-w-[7rem]">
                        <p className="text-2xl font-bold text-primary">{p.research.totalCitations}</p>
                        <p className="text-sm text-muted-foreground">Citations</p>
                      </div>
                    )}
                    {p.research.hIndex > 0 && (
                      <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center min-w-[7rem]">
                        <p className="text-2xl font-bold text-primary">{p.research.hIndex}</p>
                        <p className="text-sm text-muted-foreground">h-index</p>
                      </div>
                    )}
                    {p.research.i10Index > 0 && (
                      <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center min-w-[7rem]">
                        <p className="text-2xl font-bold text-primary">{p.research.i10Index}</p>
                        <p className="text-sm text-muted-foreground">i10-index</p>
                      </div>
                    )}
                  </div>
                )}
                {scholarLinks.length > 0 && (
                  <div className="flex flex-wrap gap-4 pb-5">
                    {scholarLinks.map((l) => (
                      <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-base text-primary hover:underline">
                        {l.label}<ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ))}
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
              </SectionBlock>
            )}

            {showBooks && p.research && (
              <SectionBlock id="books" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.books}>Books / Book Chapters Published</SectionHeading>
                <EntryList>
                  {p.research.authoredBooks.map((b, i) => (
                    <EntryCard key={i}><span className="font-medium">{b.title}</span> — {b.publisher} ({b.year})</EntryCard>
                  ))}
                </EntryList>
              </SectionBlock>
            )}

            {showFunded && p.projects && (
              <SectionBlock id="funded" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.funded}>Funded Projects</SectionHeading>
                <EntryList>
                  {p.projects.fundedProjects.map((proj, i) => (
                    <EntryCard key={i}>
                      <span className="font-medium">{proj.title}</span> — {proj.fundingAgency} ({proj.year})
                      {proj.piOrCoPi ? `, ${proj.piOrCoPi === "PI" ? "Principal Investigator" : "Co-Principal Investigator"}` : ""}
                      {proj.status && <Badge variant="outline" className="ml-1.5 text-xs">{proj.status}</Badge>}
                    </EntryCard>
                  ))}
                </EntryList>
              </SectionBlock>
            )}

            {showConsultancy && p.projects && (
              <SectionBlock id="consultancy" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.consultancy}>Consultancy Projects</SectionHeading>
                <EntryList>
                  {p.projects.consultancyProjects.map((proj, i) => (
                    <EntryCard key={i}>
                      <span className="font-medium">{proj.title}</span> — {proj.clientOrAgency} ({proj.year})
                      {proj.status && <Badge variant="outline" className="ml-1.5 text-xs">{proj.status}</Badge>}
                    </EntryCard>
                  ))}
                </EntryList>
              </SectionBlock>
            )}

            {showPatents && patents && (
              <SectionBlock id="patents" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.patents}>Patents Published</SectionHeading>
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  {patents.indianGranted > 0 && (
                    <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center">
                      <p className="text-2xl font-bold text-primary">{patents.indianGranted}</p>
                      <p className="text-sm text-muted-foreground">India — Granted</p>
                    </div>
                  )}
                  {patents.indianFiled > 0 && (
                    <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center">
                      <p className="text-2xl font-bold text-primary">{patents.indianFiled}</p>
                      <p className="text-sm text-muted-foreground">India — Filed</p>
                    </div>
                  )}
                  {patents.internationalGranted > 0 && (
                    <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center">
                      <p className="text-2xl font-bold text-primary">{patents.internationalGranted}</p>
                      <p className="text-sm text-muted-foreground">International — Granted</p>
                    </div>
                  )}
                  {patents.internationalFiled > 0 && (
                    <div className="rounded-lg border bg-muted/30 px-5 py-3 text-center">
                      <p className="text-2xl font-bold text-primary">{patents.internationalFiled}</p>
                      <p className="text-sm text-muted-foreground">International — Filed</p>
                    </div>
                  )}
                </div>
              </SectionBlock>
            )}

            {showAwards && p.recognition && (
              <SectionBlock id="awards" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.awards}>Awards & Recognitions</SectionHeading>
                <EntryList>
                  {p.recognition.awardEntries.map((a, i) => (
                    <EntryCard key={i}><span className="font-medium">{a.title}</span> — {a.awardingBody} ({a.year})</EntryCard>
                  ))}
                </EntryList>
              </SectionBlock>
            )}

            {showExposure && p.recognition && (
              <SectionBlock id="exposure" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.exposure}>International Collaborations</SectionHeading>
                <div className="space-y-5">
                  {p.recognition.internationalExposure && (
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">International Exposure</p>
                      <p className="text-base leading-relaxed">{p.recognition.internationalExposure}</p>
                    </div>
                  )}
                  {p.recognition.nationalExposure && (
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">National Exposure</p>
                      <p className="text-base leading-relaxed">{p.recognition.nationalExposure}</p>
                    </div>
                  )}
                </div>
              </SectionBlock>
            )}

            {showEngagement && p.recognition && (
              <SectionBlock id="engagement" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.engagement}>Professional Engagement</SectionHeading>
                <div className="space-y-6">
                  {p.recognition.adminResponsibilityEntries.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Institutional Responsibilities</p>
                      <EntryList>
                        {p.recognition.adminResponsibilityEntries.map((r, i) => (
                          <EntryCard key={i}>
                            <span className="font-medium">{ADMIN_RESPONSIBILITY_CATEGORY_LABELS[r.category]}</span>
                            {r.description ? ` — ${r.description}` : ""}
                            {r.fromYear && <span className="text-muted-foreground"> &middot; {r.fromYear}–{r.toYear ?? "present"}</span>}
                          </EntryCard>
                        ))}
                      </EntryList>
                    </div>
                  )}
                  {p.recognition.professionalMemberships.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Professional Memberships</p>
                      <div className="flex flex-wrap gap-1.5">
                        {p.recognition.professionalMemberships.map((m, i) => (
                          <Badge key={i} variant="outline">
                            {m.body === "OTHER" ? m.otherName : PROFESSIONAL_BODY_LABELS[m.body]}
                            {m.sinceYear ? ` (since ${m.sinceYear})` : ""}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.recognition.trainingEntries.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Certifications & Trainings</p>
                      <EntryList>
                        {p.recognition.trainingEntries.map((t, i) => (
                          <EntryCard key={i}>
                            <span className="font-medium">{t.title}</span> — {TRAINING_ENTRY_TYPE_LABELS[t.type]}, {t.organizer} ({t.year})
                          </EntryCard>
                        ))}
                      </EntryList>
                    </div>
                  )}
                  {p.recognition.labsEstablished.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Labs Established</p>
                      <EntryList>
                        {p.recognition.labsEstablished.map((l, i) => (
                          <EntryCard key={i}><span className="font-medium">{l.facilityDetails}</span>{l.outcomes ? ` — ${l.outcomes}` : ""}</EntryCard>
                        ))}
                      </EntryList>
                    </div>
                  )}
                </div>
              </SectionBlock>
            )}

            {showOther && (
              <SectionBlock id="other" refCb={registerSectionRef}>
                <SectionHeading icon={SECTION_ICONS.other}>Other Information</SectionHeading>
                <p className="text-base leading-relaxed whitespace-pre-wrap">{p.otherInformation}</p>
              </SectionBlock>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
