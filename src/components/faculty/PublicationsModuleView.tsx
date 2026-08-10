"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Section, SubLabel, Field } from "@/components/shared/ProfileFieldPrimitives";
import type { FacultyProfileFields, ResearchPublication } from "@/types";

const PREVIEW_COUNT = 3;

function PublicationRow({ pub }: { pub: ResearchPublication }) {
  return (
    <div className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
      <Field label="Title" value={pub.title} />
      <Field label="Co-Authors" value={pub.coAuthors} />
      <Field label="Journal / Conference" value={pub.journalOrConference} />
      <Field label="Year" value={pub.publicationYear} />
      <Field label="Indexing" value={pub.indexing} />
      {pub.driveLink && (
        <a
          href={pub.driveLink}
          target="_blank"
          rel="noopener noreferrer"
          className="col-span-2 sm:col-span-5 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />View Publication
        </a>
      )}
    </div>
  );
}

// Research Publications module - the paper list itself is now R&D-managed
// (see /api/college/publications), read-only here for everyone but R&D.
// The surrounding bibliometric stats/IDs stay self-reported on academicProfile.
// Split from PublicationsSection below so callers that already have the list
// (e.g. Management dashboards, which fetch it server-side via a different API
// surface - see ProfileFieldsView.tsx's ResearchModule) can skip the fetch.
export function PublicationsModuleView({ uid, academicProfile }: { uid?: string; academicProfile: Partial<FacultyProfileFields> | undefined }) {
  const [publications, setPublications] = useState<ResearchPublication[] | null>(null);

  useEffect(() => {
    const url = uid ? `/api/college/publications?uid=${encodeURIComponent(uid)}` : "/api/college/publications";
    fetch(url)
      .then((r) => r.json() as Promise<{ publications?: ResearchPublication[] }>)
      .then((d) => setPublications(d.publications ?? []))
      .catch(() => setPublications([]));
  }, [uid]);

  return <PublicationsSection publications={publications} academicProfile={academicProfile} />;
}

export function PublicationsSection({ publications, academicProfile }: { publications: ResearchPublication[] | null; academicProfile: Partial<FacultyProfileFields> | undefined }) {
  const p = academicProfile ?? {};
  const [expanded, setExpanded] = useState(false);

  const sorted = (publications ?? []).slice().sort((a, b) => (b.publicationYear ?? 0) - (a.publicationYear ?? 0));
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  return (
    <Section number={3} title="Research Publications">
      <div className="space-y-2">
        <SubLabel>Publications</SubLabel>
        {publications === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground">None recorded.</p>
        ) : (
          <div className="space-y-2">
            {visible.map((pub) => <PublicationRow key={pub.id} pub={pub} />)}
            {sorted.length > PREVIEW_COUNT && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
                {expanded ? "Show less" : `Show ${hidden} more`}
              </button>
            )}
          </div>
        )}
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
  );
}
