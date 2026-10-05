"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { ActiveLeaveNowCard } from "@/components/leave/ActiveLeaveNowCard";
import { NON_DEPARTMENTAL_STAFF_ROLES } from "@/lib/leave/nonDepartmentalStaffRoles";
import { ROLE_LABELS } from "@/types";
import type { Department } from "@/types";

export default function PrincipalLeaveHistoryDepartmentsPage() {
  const router = useRouter();
  // Picking from either dropdown used to navigate on the spot, so a mis-click
  // loaded a whole department's register and the only way back was the browser
  // button. The choice is held here instead and acted on by Load.
  //
  // The two are alternatives, not a pair - a register belongs to a department
  // OR to a college-wide role - so choosing one clears the other rather than
  // leaving a stale value behind for Load to pick the wrong one from.
  const [deptId, setDeptId] = useState("");
  const [role, setRole] = useState("");
  const target = deptId || role;

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["principal-leave-history-departments"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });

  // Keyed by department name (how LeaveRequest.department is stored, same
  // string the HOD-scoped queries elsewhere in the leave module match on).
  const { data: absentToday = {} } = useQuery({
    queryKey: ["principal-leave-history-absent-today"],
    queryFn: () =>
      fetch("/api/college/leave-history-report/absent-today")
        .then((r) => r.json() as Promise<{ counts: Record<string, number> }>)
        .then((d) => d.counts ?? {}),
  });

  // Sub-departments (e.g. BS-Chemistry under Basic Science) get their own
  // register reached via the parent's page - see [deptId]/page.tsx - so they
  // aren't peers of their parent here.
  const topLevelDepartments = departments.filter((d) => !d.parentDepartmentId);

  return (
    <div className="space-y-6">
      <PageHeader title="Leave History" description="Pick a department or a college-wide role to view its leave register" />

      <ActiveLeaveNowCard />

      <Card>
        <CardContent className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Department</Label>
            <Select
              value={deptId}
              disabled={isLoading || topLevelDepartments.length === 0}
              onValueChange={(v) => { setDeptId(v); setRole(""); }}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? "Loading..." : topLevelDepartments.length === 0 ? "No departments yet" : "Select a department..."} />
              </SelectTrigger>
              <SelectContent>
                {topLevelDepartments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} ({d.code})
                    {!!absentToday[d.name] && ` — ${absentToday[d.name]} absent today`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* College-wide roles (Vice Principal, College Office, Academics, IQAC,
              T&P, R&D, Library, Exam Cell, Webmaster, ...) never belong to a
              department - each gets its own leave register instead. */}
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => { setRole(v); setDeptId(""); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role..." />
              </SelectTrigger>
              <SelectContent>
                {NON_DEPARTMENTAL_STAFF_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Button onClick={() => target && router.push(`/principal/leave-history/${target}`)} disabled={!target}>
              <Search className="h-4 w-4 mr-1.5" />
              Load
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
