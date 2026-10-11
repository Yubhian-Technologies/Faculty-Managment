"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Wallet, Share2, Mail, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/shared/Avatar";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ChangeCollegeEmailDialog } from "@/components/faculty/ChangeCollegeEmailDialog";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { ROLE_LABELS } from "@/types";
import type { FMSUser, FacultyMember, UserRole } from "@/types";

// Everyone whose Promotion & Salary College Office edits, in one list.
// HOD / Principal / Vice Principal keep their self-reported academic profile on
// their login doc (edited by uid); everyone else is a facultyMembers record
// (edited by faculty id). The two live behind different routes, so each row
// remembers which it is.
const LEADERSHIP_ROLES: UserRole[] = ["HOD", "PRINCIPAL", "VICE_PRINCIPAL"];
const FACULTY_FILTER = "FACULTY";

type PayrollRow = {
  key: string;
  name: string;
  role: string; // a UserRole, or FACULTY_FILTER
  department?: string;
  photoUrl?: string;
  employeeId?: string;
  facultyId?: string; // set for rows backed by a facultyMembers record
  editPath: string;
};

type LoginRow = Pick<FMSUser, "uid" | "name" | "role" | "department" | "profilePhotoUrl" | "seatRoles">;
type FacultyRow = Record<string, unknown> & FacultyMember;

// HOD / Principal / Vice Principal are SEATS: the person is usually a faculty
// login whose own `role` is something else (PANEL_MEMBER...) and the position is
// carried on `seatRoles`. Matching on `role` alone hid every seat holder.
function leadershipRole(u: LoginRow): UserRole | undefined {
  return LEADERSHIP_ROLES.find((r) => u.role === r || u.seatRoles?.includes(r));
}

export default function CollegeOfficePayPromotionsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [emailTarget, setEmailTarget] = useState<{ id: string; employeeId: string; name: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/users?includeAll=true").then((r) => r.json() as Promise<{ users?: LoginRow[] }>),
      fetch("/api/college/faculty").then((r) => r.json() as Promise<{ faculty?: FacultyRow[] }>),
    ])
      .then(([u, f]) => {
        const leaders: PayrollRow[] = [];
        const leaderUids = new Set<string>();
        // A leader who is also on the faculty roster keeps their pay details on
        // that record (their login doc is near-empty), so edit it there.
        const facultyIdByUid = new Map<string, string>();
        for (const m of f.faculty ?? []) if (m.userUid) facultyIdByUid.set(m.userUid, m.id);
        for (const user of u.users ?? []) {
          const role = leadershipRole(user);
          if (!role) continue;
          leaderUids.add(user.uid);
          leaders.push({
            key: `user-${user.uid}`,
            name: user.name,
            role,
            department: user.department,
            photoUrl: user.profilePhotoUrl,
            facultyId: facultyIdByUid.get(user.uid),
            editPath: facultyIdByUid.has(user.uid)
              ? `/college-office/faculty/${facultyIdByUid.get(user.uid)}/promotion-salary`
              : `/college-office/staff/${user.uid}/promotion-salary`,
          });
        }
        // A faculty record that belongs to a leader is the same person - they
        // stay a single leadership row rather than appearing twice.
        const faculty: PayrollRow[] = (f.faculty ?? [])
          .filter((m) => !m.userUid || !leaderUids.has(m.userUid))
          .map((m) => ({
            key: `faculty-${m.id}`,
            name: facultyDisplayName(m) || "-",
            role: FACULTY_FILTER,
            department: m.department as string | undefined,
            photoUrl: m.profilePhotoUrl as string | undefined,
            employeeId: m.employeeId as string | undefined,
            facultyId: m.id,
            editPath: `/college-office/faculty/${m.id}/promotion-salary`,
          }));
        setRows([...leaders, ...faculty]);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff" }))
      .finally(() => setIsLoading(false));
  }, []);

  function copyPublicProfileLink(row: PayrollRow) {
    if (!row.employeeId) return;
    void navigator.clipboard.writeText(`${window.location.origin}/faculty-public/facultyid=${encodeURIComponent(row.employeeId)}`);
    toast({ variant: "success", title: "Public profile link copied" });
  }

  const departmentNames = [...new Set(rows.map((r) => r.department).filter((d): d is string => !!d))].sort();
  const visible = rows.filter(
    (r) => (roleFilter === "ALL" || r.role === roleFilter) && (deptFilter === "ALL" || r.department === deptFilter),
  );

  const columns: Column<PayrollRow>[] = [
    {
      key: "name",
      header: "Staff Member",
      render: (row) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={row.name} photoUrl={row.photoUrl} size="sm" className="mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <p className="font-medium leading-tight">{row.name}</p>
            {row.employeeId && <p className="text-xs text-muted-foreground">ID: {row.employeeId}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge variant="outline">{row.role === FACULTY_FILTER ? "Faculty" : (ROLE_LABELS[row.role as UserRole] ?? row.role)}</Badge>
      ),
    },
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{row.department || "-"}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(row.editPath); }}>
            <Wallet className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Promotion & Salary</span>
          </Button>
          {row.facultyId && (
            <Button
              variant="ghost" size="sm"
              onClick={(e) => { e.stopPropagation(); setEmailTarget({ id: row.facultyId as string, employeeId: row.employeeId ?? "", name: row.name }); }}
            >
              <Mail className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Change College Email</span>
            </Button>
          )}
          {row.role === FACULTY_FILTER && row.employeeId && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); copyPublicProfileLink(row); }}>
              <Share2 className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Copy Public Link</span>
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pay & Promotions"
        description="Update promotion history and salary details for faculty, HOD, Vice Principal and Principal, and change a faculty member's college email"
        actions={
          <Button variant="outline" asChild>
            <Link href="/college-office/faculty/college-email-import"><Upload className="mr-2 h-4 w-4" />Bulk Update College Emails</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All roles</SelectItem>
                <SelectItem value={FACULTY_FILTER}>Faculty</SelectItem>
                {LEADERSHIP_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All departments</SelectItem>
                {departmentNames.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <DataTable
        data={visible}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.key}
        onRowClick={(row) => router.push(row.editPath)}
        searchPlaceholder="Search by name, employee ID..."
        searchKeys={["name", "employeeId"] as (keyof PayrollRow)[]}
        paginate={false}
        groupBy={(row) => row.department || "College-wide"}
        emptyTitle="No matching profiles"
      />

      <ChangeCollegeEmailDialog
        faculty={emailTarget}
        onClose={() => setEmailTarget(null)}
        onChanged={() => setEmailTarget(null)}
      />
    </div>
  );
}
