"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Wallet, Share2, Mail, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/shared/Avatar";
import { toast } from "@/hooks/useToast";
import { ChangeCollegeEmailDialog } from "@/components/faculty/ChangeCollegeEmailDialog";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { DESIGNATION_LABELS } from "@/types";
import type { FacultyMember, Designation } from "@/types";

type FacultyRow = Record<string, unknown> & FacultyMember;

// College Office's own faculty list - unlike HOD's Faculty Register, this
// exists only to reach the Promotion & Salary editor per person (see
// [id]/promotion-salary/page.tsx). Office has no other reason to browse or
// edit the faculty roster.
export default function CollegeOfficeFacultyPage() {
  const router = useRouter();
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [emailTarget, setEmailTarget] = useState<{ id: string; employeeId: string; name: string } | null>(null);

  useEffect(() => {
    fetch("/api/college/faculty")
      .then((r) => r.json() as Promise<{ faculty: FacultyRow[] }>)
      .then((d) => setFaculty(d.faculty ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty" }))
      .finally(() => setIsLoading(false));
  }, []);

  function copyPublicProfileLink(row: FacultyRow) {
    if (!row.employeeId) return;
    void navigator.clipboard.writeText(`${window.location.origin}/faculty-public/facultyid=${encodeURIComponent(row.employeeId)}`);
    toast({ variant: "success", title: "Public profile link copied" });
  }

  const columns: Column<FacultyRow>[] = [
    {
      key: "name",
      header: "Faculty Member",
      render: (row) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={facultyDisplayName(row)} photoUrl={row.profilePhotoUrl as string | undefined} size="sm" className="mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <p className="font-medium leading-tight">{facultyDisplayName(row) || "-"}</p>
            <p className="text-xs text-muted-foreground">ID: {row.employeeId as string}</p>
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (row) => <p className="text-sm">{DESIGNATION_LABELS[row.designation as Designation] ?? (row.designation as string)}</p>,
    },
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{row.department as string}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/college-office/faculty/${row.id}/promotion-salary`); }}>
            <Wallet className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Promotion & Salary</span>
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={(e) => { e.stopPropagation(); setEmailTarget({ id: row.id as string, employeeId: (row.employeeId as string) ?? "", name: facultyDisplayName(row) || (row.employeeId as string) }); }}
          >
            <Mail className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Change College Email</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); copyPublicProfileLink(row); }}>
            <Share2 className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Copy Public Link</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty"
        description="Update promotion history and salary details, and change a faculty member's college email"
        actions={
          <Button variant="outline" asChild>
            <Link href="/college-office/faculty/college-email-import"><Upload className="mr-2 h-4 w-4" />Bulk Update College Emails</Link>
          </Button>
        }
      />

      <DataTable
        data={faculty}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        onRowClick={(row) => router.push(`/college-office/faculty/${row.id}/promotion-salary`)}
        searchPlaceholder="Search by name, employee ID..."
        searchKeys={["legalName", "nameAsPerPan", "employeeId"] as (keyof FacultyRow)[]}
        paginate={false}
        groupBy={(row) => (row.department as string) || "Unassigned"}
        emptyTitle="No faculty records yet"
      />

      <ChangeCollegeEmailDialog
        faculty={emailTarget}
        onClose={() => setEmailTarget(null)}
        onChanged={(id, email) => setFaculty((rows) => rows.map((r) => (r.id === id ? ({ ...r, collegeEmail: email } as FacultyRow) : r)))}
      />
    </div>
  );
}
