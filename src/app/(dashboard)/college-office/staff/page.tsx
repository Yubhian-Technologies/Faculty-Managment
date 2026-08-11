"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/shared/Avatar";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

// HOD and Principal keep their own self-reported academic profile on their
// login doc rather than a facultyMembers record - so their Promotion & Salary
// editing needs a separate picker from college-office/faculty (which covers
// the facultyMembers roster).
const EDITABLE_ROLES = ["HOD", "PRINCIPAL"];

type StaffRow = Record<string, unknown> & Pick<FMSUser, "uid" | "name" | "role" | "department" | "profilePhotoUrl">;

export default function CollegeOfficeStaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/users?includeAll=true")
      .then((r) => r.json() as Promise<{ users: StaffRow[] }>)
      .then((d) => setStaff((d.users ?? []).filter((u) => EDITABLE_ROLES.includes(u.role))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff" }))
      .finally(() => setIsLoading(false));
  }, []);

  const columns: Column<StaffRow>[] = [
    {
      key: "name",
      header: "Staff Member",
      render: (row) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={row.name} photoUrl={row.profilePhotoUrl} size="sm" className="mt-0.5" />
          <p className="font-medium leading-tight">{row.name}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => <Badge variant="outline">{ROLE_LABELS[row.role] ?? row.role}</Badge>,
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
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/college-office/staff/${row.uid}/promotion-salary`); }}>
          <Wallet className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Promotion & Salary</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Staff" description="Update promotion history and salary details for HOD and Principal profiles" />

      <DataTable
        data={staff}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.uid}
        onRowClick={(row) => router.push(`/college-office/staff/${row.uid}/promotion-salary`)}
        searchPlaceholder="Search by name..."
        searchKeys={["name"] as (keyof StaffRow)[]}
        groupBy={(row) => (row.department as string) || "College-wide"}
        emptyTitle="No HOD or Principal profiles yet"
      />
    </div>
  );
}
