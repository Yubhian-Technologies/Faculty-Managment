"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { loadOptions, listRequests, type ListView } from "./api";
import { ConfigPanel } from "./ConfigPanel";
import { RequestForm } from "./RequestForm";
import { RequestList } from "./RequestList";
import { SectionPermissionsFeed } from "./SectionPermissionsFeed";

// One workspace, composed per role. Each role page just says which tabs it has:
//   student   - raise a request for myself, track mine, view section approved (CR)
//   faculty   - raise one for students, track mine, approve what's routed to me (class incharge)
//   approver  - inbox, oversight of the department(s), routing configuration (Principal / delegated HOD)

export type PermissionTab =
  | "new"
  | "mine"
  | "section"
  | "inbox"
  | "oversight"
  | "routing";

const LABELS: Record<PermissionTab, string> = {
  new: "New Request",
  mine: "My Requests",
  section: "Section Feed",
  inbox: "Waiting for Me",
  oversight: "All Requests",
  routing: "Routing",
};

/** Tabs whose count is worth showing on the tab itself. */
const COUNTED: Partial<Record<PermissionTab, ListView>> = {
  inbox: "inbox",
  oversight: "oversight",
  mine: "mine",
};

export function PermissionsWorkspace({
  mode,
  tabs,
  title,
  description,
}: {
  mode: "student" | "faculty";
  tabs: PermissionTab[];
  title: string;
  description: string;
}) {
  const qc = useQueryClient();
  // The Section Feed belongs to the section's Class Representatives, not every student.
  const { data: opts } = useQuery({
    queryKey: ["student-permission-options"],
    queryFn: () => loadOptions(),
    enabled: tabs.includes("section"),
    staleTime: 60_000,
  });
  const visibleTabs = useMemo(
    () => tabs.filter((t) => t !== "section" || opts?.isClassRepresentative),
    [tabs, opts?.isClassRepresentative],
  );
  const [tab, setTab] = useState<PermissionTab>(tabs[0]);
  const [version, setVersion] = useState(0); // remounts the lists after a new request

  // Count badges for the decision-bearing tabs, refreshed alongside the lists.
  const countable = visibleTabs.filter((t) => COUNTED[t]);
  const { data: counts } = useQuery({
    queryKey: ["student-permissions", "counts", countable.join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        countable.map(
          async (t) => [t, (await listRequests(COUNTED[t]!)).length] as const,
        ),
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: countable.length > 0,
    staleTime: 15_000,
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title={title} description={description} />
      <div
        role="tablist"
        aria-label={title}
        className="flex snap-x gap-1 overflow-x-auto whitespace-nowrap border-b scrollbar-none"
        onKeyDown={(e) => {
          // Roving arrow-key navigation between tabs (Home / End jump to the ends).
          const i = visibleTabs.indexOf(tab);
          const next =
            e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? visibleTabs.length - 1 : null;
          if (next === null) return;
          e.preventDefault();
          const target = visibleTabs[(next + visibleTabs.length) % visibleTabs.length];
          setTab(target);
          document.getElementById(`perm-tab-${target}`)?.focus();
        }}
      >
        {visibleTabs.map((t) => {
          const count = counts?.[t];
          return (
            <button
              key={t}
              role="tab"
              id={`perm-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`perm-panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={(e) => {
                setTab(t);
                // On a phone the tab row scrolls sideways: keep the chosen tab in view.
                e.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
              }}
              className={`inline-flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-t-md border-b-2 px-3.5 py-2.5 text-sm transition-colors -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10 ${
                tab === t
                  ? "border-primary bg-primary/5 font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {LABELS[t]}
              {typeof count === "number" && count > 0 && (
                <span
                  className={`inline-flex min-w-5 justify-center rounded-full px-1.5 text-[10px] font-semibold leading-5 ${
                    tab === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`perm-panel-${tab}`}
        aria-labelledby={`perm-tab-${tab}`}
      >
        {tab === "new" && (
          <RequestForm
            mode={mode}
            onCreated={() => {
              setVersion((v) => v + 1);
              void qc.invalidateQueries();
              setTab(visibleTabs.includes("mine") ? "mine" : visibleTabs[0]);
            }}
          />
        )}
        {tab === "mine" && (
          <RequestList
            key={`mine-${version}`}
            view="mine"
            empty="You haven't raised any permission requests yet."
          />
        )}
        {tab === "section" && opts?.isClassRepresentative && (
          <SectionPermissionsFeed />
        )}
        {tab === "inbox" && (
          <RequestList
            key="inbox"
            view="inbox"
            empty="Nothing is waiting for your decision."
          />
        )}
        {tab === "oversight" && (
          <RequestList
            key="oversight"
            view="oversight"
            empty="No requests in your scope yet."
          />
        )}
        {tab === "routing" && <ConfigPanel />}
      </div>
    </div>
  );
}
