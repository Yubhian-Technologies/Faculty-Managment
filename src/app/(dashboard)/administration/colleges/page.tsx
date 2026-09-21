"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, ChevronDown, ChevronUp, Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { COLLEGE_TYPE_LABELS } from "@/types";
import type { College } from "@/types";

type PrincipalRow = { uid: string; name: string; email: string; role: string; isActive: boolean };

export default function AdministrationCollegesPage() {
  const router = useRouter();
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Read-only: who currently holds the Principal/VP seat, shown in each row's
  // expanded detail. There's no "Add Principal" action on this page any more
  // - Principal (and every other seat) is appointed from within the college,
  // by its College Admin, via Role Assignments - never handed out directly by
  // Location Admin (see api/administration/college-people's comment).
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
    loadAll();
    // Re-fetch whenever the tab regains focus (e.g. coming back from the "Add
    // College Admin" page via the browser's back button, which can restore
    // this page's previous in-memory state via Next's router cache instead
    // of remounting it) so a newly-added person is reflected without
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

          return (
            <div key={college.id} className="rounded-lg border bg-card overflow-hidden">
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
