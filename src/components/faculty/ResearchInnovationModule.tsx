"use client";

import { useState } from "react";
import { Section } from "@/components/shared/ProfileFieldPrimitives";
import { PublicationsModuleView, PublicationsSection } from "@/components/faculty/PublicationsModuleView";
import { ResearchProfilesSection } from "@/components/faculty/ResearchProfilesModuleView";
import { CitationMetricsSection } from "@/components/faculty/CitationMetricsModuleView";
import { ConsultancyProjectsModuleView } from "@/components/faculty/ConsultancyProjectsModuleView";
import { SeedFundingModuleView } from "@/components/faculty/SeedFundingModuleView";
import { SponsoredProjectsModuleView } from "@/components/faculty/SponsoredProjectsModuleView";
import { DiscoveryInnovationModuleView } from "@/components/faculty/DiscoveryInnovationModuleView";
import { PhdSupervisionModuleView } from "@/components/faculty/PhdSupervisionModuleView";
import { ResearchServicesModuleView } from "@/components/faculty/ResearchServicesModuleView";
import { HackathonsModuleView } from "@/components/faculty/HackathonsModuleView";
import { InnovationsModuleView } from "@/components/faculty/InnovationsModuleView";
import { RESEARCH_INNOVATION_TABS, type ResearchInnovationTabKey } from "@/lib/faculty/researchInnovationTabs";
import type { FacultyProfileFields, ResearchPublication } from "@/types";

interface Props {
  uid?: string;
  academicProfile: Partial<FacultyProfileFields> | undefined;
  // Only for callers that already fetched the publications list server-side
  // alongside the faculty record itself - see FacultyProfileModuleContent's
  // own doc-comment on `publications`. Undefined means the Research
  // Publications tab fetches it itself.
  publications?: ResearchPublication[] | null;
  // True only when the viewer IS this profile's owner - see
  // FacultyProfileModuleContent's own doc-comment on `isOwnProfile`.
  isOwnProfile?: boolean;
}

// Research & Innovation's own sub-tab bar (see profileModules.ts). Research
// Publications (the R&D-managed publication list) and Research Profiles (the
// self-reported researcher IDs) are the only tabs with real fields so far -
// same content this module always had before it grew sub-tabs, just split
// across two of them. The other eight are scaffolded empty for now; each
// gets its own field set later, one at a time.
export function ResearchInnovationModule({ uid, academicProfile, publications, isOwnProfile }: Props) {
  const [activeTab, setActiveTab] = useState<ResearchInnovationTabKey>("research-profiles");
  const activeLabel = RESEARCH_INNOVATION_TABS.find((t) => t.key === activeTab)?.label ?? "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {RESEARCH_INNOVATION_TABS.map((tab) => (
          <button
            type="button"
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeTab === tab.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "publications" ? (
        publications !== undefined
          ? <PublicationsSection publications={publications} academicProfile={academicProfile} isOwnProfile={isOwnProfile} />
          : <PublicationsModuleView uid={uid} academicProfile={academicProfile} isOwnProfile={isOwnProfile} />
      ) : activeTab === "research-profiles" ? (
        <ResearchProfilesSection academicProfile={academicProfile} isOwnProfile={isOwnProfile} />
      ) : activeTab === "citations" ? (
        <CitationMetricsSection academicProfile={academicProfile} isOwnProfile={isOwnProfile} />
      ) : activeTab === "consultancy-projects" ? (
        <ConsultancyProjectsModuleView uid={uid} isOwnProfile={isOwnProfile} />
      ) : activeTab === "seed-funding" ? (
        <SeedFundingModuleView uid={uid} isOwnProfile={isOwnProfile} />
      ) : activeTab === "sponsored-projects" ? (
        <SponsoredProjectsModuleView uid={uid} isOwnProfile={isOwnProfile} />
      ) : activeTab === "discovery-innovation" ? (
        <DiscoveryInnovationModuleView uid={uid} isOwnProfile={isOwnProfile} />
      ) : activeTab === "phd-supervision" ? (
        <PhdSupervisionModuleView uid={uid} isOwnProfile={isOwnProfile} />
      ) : activeTab === "research-services" ? (
        <ResearchServicesModuleView uid={uid} isOwnProfile={isOwnProfile} />
      ) : activeTab === "hackathons" ? (
        <HackathonsModuleView uid={uid} isOwnProfile={isOwnProfile} />
      ) : activeTab === "innovations" ? (
        <InnovationsModuleView uid={uid} isOwnProfile={isOwnProfile} />
      ) : (
        <Section number={3} title={activeLabel}>
          <p className="text-sm text-muted-foreground">This section hasn&rsquo;t been built out yet - check back soon.</p>
        </Section>
      )}
    </div>
  );
}
