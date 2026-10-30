"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Inbox,
  ListChecks,
  Megaphone,
  PlusCircle,
  Route,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
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

type TabMeta = {
  /** Full label — shown from `sm` upwards. */
  label: string;
  /** Short label — shown on phones where space is tight. */
  short: string;
  icon: LucideIcon;
};

const TABS: Record<PermissionTab, TabMeta> = {
  new: { label: "New Request", short: "New", icon: PlusCircle },
  mine: { label: "My Requests", short: "Mine", icon: ListChecks },
  section: { label: "Section Feed", short: "Section", icon: Megaphone },
  inbox: { label: "Waiting for Me", short: "Inbox", icon: Inbox },
  oversight: { label: "All Requests", short: "All", icon: ShieldCheck },
  routing: { label: "Routing", short: "Routing", icon: Route },
};

/** Tabs whose count is worth showing on the tab itself. */
const COUNTED: Partial<Record<PermissionTab, ListView>> = {
  inbox: "inbox",
  oversight: "oversight",
  mine: "mine",
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    () => tabs.filter((t) => t !== "section" || !!opts?.isClassRepresentative),
    [tabs, opts?.isClassRepresentative],
  );

  // BUG FIX: never land on a tab that isn't currently visible (e.g. "section"
  // before the class-representative check resolves).
  const [tab, setTab] = useState<PermissionTab>(
    () => tabs.find((t) => t !== "section") ?? tabs[0],
  );

  // If the selected tab disappears (role change, options re-fetch), fall back.
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.includes(tab)) {
      setTab(visibleTabs[0]);
    }
  }, [visibleTabs, tab]);

  const [version, setVersion] = useState(0); // remounts the lists after a new request

  // Count badges for the decision-bearing tabs, refreshed alongside the lists.
  const countable = useMemo(
    () => visibleTabs.filter((t) => COUNTED[t]),
    [visibleTabs],
  );

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

  // --- Horizontal-scroll affordances -------------------------------------
  // On phones the tab strip scrolls sideways; show gradient fades on the
  // edges that still have hidden tabs so users know to swipe.
  const tablistRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const syncEdges = useCallback(() => {
    const el = tablistRef.current;
    if (!el) return;
    const { scrollLeft, clientWidth, scrollWidth } = el;
    const left = scrollLeft > 4;
    const right = scrollLeft + clientWidth < scrollWidth - 4;
    setEdges((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right },
    );
  }, []);

  useEffect(() => {
    const el = tablistRef.current;
    if (!el) return;
    syncEdges();
    el.addEventListener("scroll", syncEdges, { passive: true });
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", syncEdges);
      ro.disconnect();
    };
  }, [syncEdges]);

  // Re-measure whenever the visible tab set changes.
  useEffect(() => {
    syncEdges();
  }, [visibleTabs.length, syncEdges]);

  // --- Handlers ----------------------------------------------------------
  const selectTab = useCallback(
    (t: PermissionTab, e: ReactMouseEvent<HTMLButtonElement>) => {
      setTab(t);
      // On a phone the tab row scrolls sideways: keep the chosen tab in view.
      e.currentTarget.scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    },
    [],
  );

  // Roving arrow-key navigation between tabs (Home / End jump to the ends).
  const handleTablistKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (visibleTabs.length === 0) return;
      const i = visibleTabs.indexOf(tab);
      let next: number | null = null;
      if (e.key === "ArrowRight") next = i + 1;
      else if (e.key === "ArrowLeft") next = i - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = visibleTabs.length - 1;
      if (next === null) return;
      e.preventDefault();
      const target =
        visibleTabs[(next + visibleTabs.length) % visibleTabs.length];
      setTab(target);
      requestAnimationFrame(() =>
        document.getElementById(`perm-tab-${target}`)?.focus(),
      );
    },
    [visibleTabs, tab],
  );

  const handleCreated = useCallback(() => {
    setVersion((v) => v + 1);
    void qc.invalidateQueries();
    setTab(visibleTabs.includes("mine") ? "mine" : visibleTabs[0]);
  }, [qc, visibleTabs]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title={title} description={description} />

      {/* Sticky so the tab bar stays reachable while scrolling long lists. */}
      <div className="relative sticky top-0 z-20 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent transition-opacity duration-200 sm:w-8 ${
            edges.left ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent transition-opacity duration-200 sm:w-8 ${
            edges.right ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          ref={tablistRef}
          role="tablist"
          aria-label={title}
          aria-orientation="horizontal"
          onKeyDown={handleTablistKeyDown}
          className="flex snap-x items-stretch gap-0.5 overflow-x-auto overscroll-x-contain whitespace-nowrap scrollbar-none sm:gap-1"
        >
          {visibleTabs.map((t) => {
            const meta = TABS[t];
            const Icon = meta.icon;
            const count = counts?.[t];
            const selected = tab === t;

            return (
              <button
                key={t}
                role="tab"
                id={`perm-tab-${t}`}
                aria-selected={selected}
                aria-controls={`perm-panel-${t}`}
                tabIndex={selected ? 0 : -1}
                onClick={(e) => selectTab(t, e)}
                className={`inline-flex min-h-11 shrink-0 touch-manipulation snap-start select-none items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2.5 text-sm transition-colors -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-10 sm:gap-2 sm:px-3.5 ${
                  selected
                    ? "border-primary bg-primary/5 font-medium text-primary"
                    : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">{meta.label}</span>
                <span className="sm:hidden">{meta.short}</span>
                {typeof count === "number" && count > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none tabular-nums ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                    <span className="sr-only">{`, ${count} pending`}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div
        key={tab}
        role="tabpanel"
        id={`perm-panel-${tab}`}
        aria-labelledby={`perm-tab-${tab}`}
        tabIndex={0}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
      >
        {tab === "new" && <RequestForm mode={mode} onCreated={handleCreated} />}
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