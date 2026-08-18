"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { Users, Pencil } from "lucide-react";
import { EFFECTIVE_CATEGORY_LABELS } from "@/types/leave";
import type { EffectiveLeaveCategory } from "@/types/leave";

const ALL_DEPARTMENTS = "__all__"; // sentinel: Radix Select items can't use an empty string value
const NO_DEPARTMENT = "No Department";

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
  // Scoped to the current tab (a department under Faculty is meaningless once
  // you're looking at Institutional Staff) - reset whenever the tab changes.
  const [departmentFilter, setDepartmentFilter] = useState(ALL_DEPARTMENTS);

  useEffect(() => {
    fetch("/api/leave/profiles")
      .then((r) => r.json() as Promise<{ roster: RosterEntry[] }>)
      .then((data) => setRoster(data.roster ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave profiles" }))
      .finally(() => setIsLoading(false));
  }, []);

  const hasInstitutionalStaff = roster.some((f) => f.staffType === "institutional");
  const staffTypeTabs = hasInstitutionalStaff ? [...BASE_STAFF_TYPE_TABS, INSTITUTIONAL_STAFF_TAB] : BASE_STAFF_TYPE_TABS;

  function selectStaffType(key: string) {
    setStaffType(key as StaffType);
    setDepartmentFilter(ALL_DEPARTMENTS);
  }

  const staffTypeRoster = roster.filter((f) => f.staffType === staffType);

  // Only meaningful for Faculty/Supporting Staff - Institutional Staff never
  // has a department (see api/leave/profiles/route.ts), and an HOD's own
  // roster is already a single department, so the filter/grouping below both
  // collapse to a no-op for them (never shown at all, in the filter's case).
  const departmentOptions = useMemo(() => {
    const depts = new Set(staffTypeRoster.map((f) => f.department || NO_DEPARTMENT));
    return Array.from(depts).sort((a, b) => a.localeCompare(b));
  }, [staffTypeRoster]);

  const visibleRoster = staffTypeRoster.filter(
    (f) => departmentFilter === ALL_DEPARTMENTS || (f.department || NO_DEPARTMENT) === departmentFilter
  );

  // Department-wise grouping (sorted headers, each group name-sorted within)
  // instead of one long flat list - a College Office/Principal/VP roster
  // spans every department at once, which got unreadable fast.
  const groupedRoster = useMemo(() => {
    const groups = new Map<string, RosterEntry[]>();
    for (const f of visibleRoster) {
      const key = f.department || NO_DEPARTMENT;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleRoster]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Profiles"
        description="Auto-set up from each person's staff details - edit only to correct a category"
      />

      <SegmentedTabs
        value={staffType}
        onChange={selectStaffType}
        options={staffTypeTabs}
      />

      {departmentOptions.length > 1 && (
        <div className="max-w-xs space-y-1.5">
          <Label>Department</Label>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DEPARTMENTS}>All Departments</SelectItem>
              {departmentOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

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
        <div className="space-y-6">
          {groupedRoster.map(([department, entries]) => (
            <div key={department} className="space-y-2">
              {departmentOptions.length > 1 && (
                <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  {department}
                  <Badge variant="outline" className="font-normal">{entries.length}</Badge>
                </h2>
              )}
              <div className="space-y-2">
                {entries.map((f) => (
                  <Card key={f.uid}>
                    <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="font-medium">{f.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {f.designation}
                          {/* Redundant once a department header is already shown above the group */}
                          {f.department && departmentOptions.length <= 1 ? ` · ${f.department}` : ""}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
