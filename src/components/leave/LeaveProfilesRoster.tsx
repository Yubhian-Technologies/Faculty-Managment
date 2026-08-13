"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { Users, Pencil } from "lucide-react";
import { EFFECTIVE_CATEGORY_LABELS } from "@/types/leave";
import type { EffectiveLeaveCategory } from "@/types/leave";

type StaffType = "faculty" | "supportingStaff" | "institutional";

interface RosterEntry {
  uid: string;
  name: string;
  department?: string;
  designation: string;
  staffType: StaffType;
  staffCategory?: string;
  effectiveCategory?: EffectiveLeaveCategory;
}

interface LeaveProfilesRosterProps {
  editHrefBase: string; // e.g. "/hod/leave/profiles" -> links to "{base}/{uid}/edit"
}

const BASE_STAFF_TYPE_TABS: { key: StaffType; label: string }[] = [
  { key: "faculty", label: "Faculty" },
  { key: "supportingStaff", label: "Supporting Staff" },
];
// Vice Principal, College Office, Dean, IQAC Coordinator, T&P, R&D, Library,
// Exam Cell, Webmaster - college-wide roles with no department, so they'd
// never appear on the two tabs above. Principal/VP-only, mirroring the Leave
// History page's own per-role registers (see nonDepartmentalStaffRoles.ts).
// HOD is department-scoped and never gets any of these back from the API,
// so the tab is only added once the roster actually has one - never shown
// (and, by construction, never populated) on HOD's own Leave Profiles page.
const INSTITUTIONAL_STAFF_TAB = { key: "institutional" as const, label: "Institutional Staff" };

// Every entry here is auto-set-up already (from FacultyMember/SupportingStaff/
// role default) by the time it's fetched - there is no "not set up" state,
// only ever an existing, editable profile.
export function LeaveProfilesRoster({ editHrefBase }: LeaveProfilesRosterProps) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [staffType, setStaffType] = useState<StaffType>("faculty");

  useEffect(() => {
    fetch("/api/leave/profiles")
      .then((r) => r.json() as Promise<{ roster: RosterEntry[] }>)
      .then((data) => setRoster(data.roster ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave profiles" }))
      .finally(() => setIsLoading(false));
  }, []);

  const hasInstitutionalStaff = roster.some((f) => f.staffType === "institutional");
  const staffTypeTabs = hasInstitutionalStaff ? [...BASE_STAFF_TYPE_TABS, INSTITUTIONAL_STAFF_TAB] : BASE_STAFF_TYPE_TABS;
  const visibleRoster = roster.filter((f) => f.staffType === staffType);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Profiles"
        description="Auto-set up from each person's staff details - edit only to correct a category"
      />

      <SegmentedTabs
        value={staffType}
        onChange={(key) => setStaffType(key as StaffType)}
        options={staffTypeTabs}
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : visibleRoster.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={staffType === "faculty" ? "No faculty found" : staffType === "supportingStaff" ? "No supporting staff found" : "No institutional staff found"}
        />
      ) : (
        <div className="space-y-2">
          {visibleRoster.map((f) => (
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
