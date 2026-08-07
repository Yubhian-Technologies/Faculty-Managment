"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { Users, Pencil } from "lucide-react";
import { EFFECTIVE_CATEGORY_LABELS } from "@/types/leave";
import type { EffectiveLeaveCategory } from "@/types/leave";

interface RosterEntry {
  uid: string;
  name: string;
  department?: string;
  designation: string;
  staffCategory?: string;
  effectiveCategory?: EffectiveLeaveCategory;
}

interface LeaveProfilesRosterProps {
  editHrefBase: string; // e.g. "/hod/leave/profiles" -> links to "{base}/{uid}/edit"
}

// Every entry here is auto-set-up already (from FacultyMember designation) by
// the time it's fetched - there is no "not set up" state, only ever an
// existing, editable profile.
export function LeaveProfilesRoster({ editHrefBase }: LeaveProfilesRosterProps) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leave/profiles")
      .then((r) => r.json() as Promise<{ roster: RosterEntry[] }>)
      .then((data) => setRoster(data.roster ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave profiles" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Profiles"
        description="Auto-set up from each person's faculty details - edit only to correct a category"
      />
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : roster.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="No faculty found" />
      ) : (
        <div className="space-y-2">
          {roster.map((f) => (
            <Card key={f.uid}>
              <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-medium">{f.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {f.designation}
                    {f.department ? ` · ${f.department}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {f.effectiveCategory && (
                    <Badge variant="secondary">{EFFECTIVE_CATEGORY_LABELS[f.effectiveCategory]}</Badge>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`${editHrefBase}/${f.uid}/edit`}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
