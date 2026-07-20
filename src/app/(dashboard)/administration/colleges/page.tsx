"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, ChevronDown, ChevronUp, Plus, CalendarRange, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { College } from "@/types";

type PrincipalRow = { uid: string; name: string; email: string; role: string; isActive: boolean };

export default function AdministrationCollegesPage() {
  const router = useRouter();
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [principalMap, setPrincipalMap] = useState<Record<string, PrincipalRow[]>>({});
  const [loadingPrincipals, setLoadingPrincipals] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }))
      .finally(() => setIsLoading(false));
  }, []);

  async function toggleExpand(college: College) {
    if (expandedId === college.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(college.id);
    if (!principalMap[college.id]) {
      setLoadingPrincipals(college.id);
      try {
        const res = await fetch(`/api/administration/principals?collegeId=${college.id}`);
        const data = await res.json() as { principals: PrincipalRow[] };
        setPrincipalMap((prev) => ({ ...prev, [college.id]: data.principals ?? [] }));
      } catch {
        toast({ variant: "destructive", title: "Failed to load principals" });
      } finally {
        setLoadingPrincipals(null);
      }
    }
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
          const principalList = principalMap[college.id]; // undefined = not loaded yet
          const hasPrincipal = principalList?.some((p) => p.role === "PRINCIPAL") ?? false;
          const hasVP = principalList?.some((p) => p.role === "VICE_PRINCIPAL") ?? false;
          // After loading: hide button if both slots filled; before loading: always show
          const showAddBtn = principalList === undefined || !hasPrincipal || !hasVP;
          const addBtnLabel = hasPrincipal && !hasVP ? "Add Vice Principal" : "Add Principal";
          const addBtnDefaultRole = hasPrincipal && !hasVP ? "VICE_PRINCIPAL" : "PRINCIPAL";

          return (
            <div key={college.id} className="rounded-lg border bg-card overflow-hidden">
              {/* College row */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{college.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{college.contactEmail ?? college.address ?? "—"}</p>
                  </div>
                  <Badge variant={college.isActive ? "default" : "secondary"} className="shrink-0">
                    {college.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/administration/colleges/${college.id}/academic-years`)}
                  >
                    <CalendarRange className="h-3.5 w-3.5 mr-1.5" />
                    Academic Years
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/administration/colleges/${college.id}/academic-sessions`)}
                  >
                    <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                    Academic Sessions
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
                    onClick={() => void toggleExpand(college)}
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Expanded principals list */}
              {isExpanded && (
                <div className="border-t px-4 pb-4 pt-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Principals & Vice Principals</p>
                  {loadingPrincipals === college.id ? (
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
