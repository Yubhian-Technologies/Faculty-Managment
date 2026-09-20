"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserPlus, UserCog, ChevronDown, ChevronUp, Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { COLLEGE_TYPE_LABELS } from "@/types";
import type { College } from "@/types";

type PrincipalRow = { uid: string; name: string; email: string; role: string; isActive: boolean };

export default function AdministrationCollegesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Seeded from the dashboard's college picker (?collegeId=) so arriving here
  // via "Colleges" with one already selected lands pre-expanded on it,
  // instead of a flat unexpanded list.
  const [expandedId, setExpandedId] = useState<string | null>(() => searchParams.get("collegeId"));
  // undefined = not loaded yet (only true briefly, while the bulk fetch below
  // is in flight) - loaded eagerly for every college on mount so the Add
  // Principal/VP button's visibility is never a guess. Previously this was
  // fetched lazily per row only when expanded, defaulting to "show the
  // button" for every collapsed row until it was, which is what made the
  // button flash/linger incorrectly for colleges that already had one.
  const [principalMap, setPrincipalMap] = useState<Record<string, PrincipalRow[]>>({});
  const [principalsLoaded, setPrincipalsLoaded] = useState(false);

  function loadAll() {
    setIsLoading(true);
    setPrincipalsLoaded(false);
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }))
      .finally(() => setIsLoading(false));

    fetch("/api/administration/principals")
      .then((r) => r.json() as Promise<{ principalsByCollege: Record<string, PrincipalRow[]> }>)
      .then((d) => setPrincipalMap(d.principalsByCollege ?? {}))
      .catch(() => toast({ variant: "destructive", title: "Failed to load principals" }))
      .finally(() => setPrincipalsLoaded(true));
  }

  useEffect(() => {
    // Runs once, after the picked college's row exists in the DOM - scrolls
    // it into view so arriving from the dashboard doesn't leave it hidden
    // below the fold in a long college list.
    if (!isLoading && expandedId) {
      document.getElementById(`college-${expandedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => {
    loadAll();
    // Re-fetch whenever the tab regains focus (e.g. coming back from the "Add
    // Principal/VP" page via the browser's back button, which can restore
    // this page's previous in-memory state via Next's router cache instead
    // of remounting it) so a newly-added Principal/VP is reflected without
    // needing a manual hard reload.
    function onFocus() { loadAll(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function toggleExpand(college: College) {
    setExpandedId((prev) => (prev === college.id ? null : college.id));
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Colleges" description="Colleges under this location" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colleges"
        description="Manage colleges and their principals in this location"
        actions={
          <Button onClick={() => router.push("/administration/colleges/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New College
          </Button>
        }
      />

      <div className="space-y-3">
        {colleges.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No colleges found in this location.</p>
        )}
        {colleges.map((college) => {
          const isExpanded = expandedId === college.id;
          const principalList = principalMap[college.id];
          const hasPrincipal = principalList?.some((p) => p.role === "PRINCIPAL") ?? false;
          const hasVP = principalList?.some((p) => p.role === "VICE_PRINCIPAL") ?? false;
          // Before the bulk fetch resolves, don't show the button at all
          // (rather than defaulting to "show") - it appears as soon as we
          // actually know whether a slot is open, never as a guess.
          const showAddBtn = principalsLoaded && (!hasPrincipal || !hasVP);
          const addBtnLabel = hasPrincipal && !hasVP ? "Add Vice Principal" : "Add Principal";
          const addBtnDefaultRole = hasPrincipal && !hasVP ? "VICE_PRINCIPAL" : "PRINCIPAL";

          return (
            <div
              key={college.id}
              id={`college-${college.id}`}
              className={`rounded-lg border bg-card overflow-hidden ${college.id === searchParams.get("collegeId") ? "ring-2 ring-primary/40" : ""}`}
            >
              {/* College row */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{college.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{college.contactEmail ?? college.address ?? "-"}</p>
                  </div>
                  {college.type && (
                    <Badge variant="outline" className="shrink-0 text-xs font-normal">
                      {COLLEGE_TYPE_LABELS[college.type]}
                    </Badge>
                  )}
                  <Badge variant={college.isActive ? "default" : "secondary"} className="shrink-0">
                    {college.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => router.push(`/administration/colleges/${college.id}/edit`)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                  {/* A college starts with no people at all: add the first ones here,
                      then appoint them to seats (College Admin, Principal, ...) in
                      Role Assignments - the seat holders take it from there. */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/administration/colleges/${college.id}/people/new`)}
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                    Add College Admin
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/administration/role-assignments?collegeId=${college.id}`)}
                  >
                    <UserCog className="h-3.5 w-3.5 mr-1.5" />
                    Role Assignments
                  </Button>
                  {showAddBtn && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/administration/colleges/${college.id}/principal/new?role=${addBtnDefaultRole}`)}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      {addBtnLabel}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleExpand(college)}
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Expanded principals list */}
              {isExpanded && (
                <div className="border-t px-4 pb-4 pt-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Principals & Vice Principals</p>
                  {!principalsLoaded ? (
                    <div className="h-8 w-32 bg-muted animate-pulse rounded" />
                  ) : (principalList ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No principals assigned yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {(principalList ?? []).map((p) => (
                        <div key={p.uid} className="flex items-center justify-between rounded-lg border bg-card p-3">
                          <div>
                            <p className="text-sm font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.email}</p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {p.role === "PRINCIPAL" ? "Principal" : "Vice Principal"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
