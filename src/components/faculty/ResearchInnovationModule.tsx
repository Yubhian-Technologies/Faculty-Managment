"use client";

import { useState } from "react";
import { Section } from "@/components/shared/ProfileFieldPrimitives";
import { PublicationsModuleView, PublicationsSection } from "@/components/faculty/PublicationsModuleView";
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
}

// Research & Innovation's own sub-tab bar (see profileModules.ts). Research
// Publications is the only tab with real fields so far - the R&D-managed
// publication list + this person's self-reported bibliometrics, same content
// this module always had before it grew sub-tabs. The other nine are
// scaffolded empty for now; each gets its own field set later, one at a time.
export function ResearchInnovationModule({ uid, academicProfile, publications }: Props) {
  const [activeTab, setActiveTab] = useState<ResearchInnovationTabKey>("publications");
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
          ? <PublicationsSection publications={publications} academicProfile={academicProfile} />
          : <PublicationsModuleView uid={uid} academicProfile={academicProfile} />
      ) : (
        <Section number={3} title={activeLabel}>
          <p className="text-sm text-muted-foreground">This section hasn&rsquo;t been built out yet - check back soon.</p>
        </Section>
      )}
    </div>
  );
}
