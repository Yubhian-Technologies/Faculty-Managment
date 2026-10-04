"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfigPanel } from "./ConfigPanel";
import { RequestForm } from "./RequestForm";
import { RequestList } from "./RequestList";

// One workspace, composed per role. Each role page just says which tabs it has:
//   student   - raise a request for myself, track mine
//   faculty   - raise one for students, track mine, approve what's routed to me (class incharge)
//   approver  - inbox, oversight of the department(s), routing configuration (Principal / delegated HOD)

export type PermissionTab = "new" | "mine" | "inbox" | "oversight" | "routing";

const LABELS: Record<PermissionTab, string> = {
  new: "New request", mine: "My requests", inbox: "Waiting for me", oversight: "All requests", routing: "Routing",
};

export function PermissionsWorkspace({ mode, tabs, title, description }: {
  mode: "student" | "faculty"; tabs: PermissionTab[]; title: string; description: string;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<PermissionTab>(tabs[0]);
  const [version, setVersion] = useState(0); // remounts the lists after a new request

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <div role="tablist" className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {LABELS[t]}
          </button>
        ))}
      </div>
      {tab === "new" && <RequestForm mode={mode} onCreated={() => { setVersion((v) => v + 1); void qc.invalidateQueries(); setTab(tabs.includes("mine") ? "mine" : tabs[0]); }} />}
      {tab === "mine" && <RequestList key={`mine-${version}`} view="mine" empty="You haven't raised any permission requests yet." />}
      {tab === "inbox" && <RequestList key="inbox" view="inbox" empty="Nothing is waiting for your decision." />}
      {tab === "oversight" && <RequestList key="oversight" view="oversight" empty="No requests in your scope yet." />}
      {tab === "routing" && <ConfigPanel />}
    </div>
  );
}
