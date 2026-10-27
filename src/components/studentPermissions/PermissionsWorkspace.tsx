"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { loadOptions } from "./api";
import { ConfigPanel } from "./ConfigPanel";
import { RequestForm } from "./RequestForm";
import { RequestList } from "./RequestList";
import { SectionPermissionsFeed } from "./SectionPermissionsFeed";

// One workspace, composed per role. Each role page just says which tabs it has:
//   student   - raise a request for myself, track mine, view section approved (CR)
//   faculty   - raise one for students, track mine, approve what's routed to me (class incharge)
//   approver  - inbox, oversight of the department(s), routing configuration (Principal / delegated HOD)

export type PermissionTab = "new" | "mine" | "section" | "inbox" | "oversight" | "routing";

const LABELS: Record<PermissionTab, string> = {
  new: "New Request", mine: "My Requests", section: "Section Feed", inbox: "Waiting for Me", oversight: "All Requests", routing: "Routing",
};

export function PermissionsWorkspace({ mode, tabs, title, description }: {
  mode: "student" | "faculty"; tabs: PermissionTab[]; title: string; description: string;
}) {
  const qc = useQueryClient();
  // The Section Feed belongs to the section's Class Representatives, not every student.
  const { data: opts } = useQuery({ queryKey: ["student-permission-options"], queryFn: () => loadOptions(), enabled: tabs.includes("section"), staleTime: 60_000 });
  const visibleTabs = tabs.filter((t) => t !== "section" || opts?.isClassRepresentative);
  const [tab, setTab] = useState<PermissionTab>(tabs[0]);
  const [version, setVersion] = useState(0); // remounts the lists after a new request

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title={title} description={description} />
      <div role="tablist" className="flex overflow-x-auto whitespace-nowrap gap-1 border-b pb-0.5 sm:pb-0 scrollbar-none">
        {visibleTabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs sm:text-sm -mb-px border-b-2 transition-colors ${tab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {LABELS[t]}
          </button>
        ))}
      </div>
      {tab === "new" && <RequestForm mode={mode} onCreated={() => { setVersion((v) => v + 1); void qc.invalidateQueries(); setTab(visibleTabs.includes("mine") ? "mine" : visibleTabs[0]); }} />}
      {tab === "mine" && <RequestList key={`mine-${version}`} view="mine" empty="You haven't raised any permission requests yet." />}
      {tab === "section" && opts?.isClassRepresentative && <SectionPermissionsFeed />}
      {tab === "inbox" && <RequestList key="inbox" view="inbox" empty="Nothing is waiting for your decision." />}
      {tab === "oversight" && <RequestList key="oversight" view="oversight" empty="No requests in your scope yet." />}
      {tab === "routing" && <ConfigPanel />}
    </div>
  );
}
