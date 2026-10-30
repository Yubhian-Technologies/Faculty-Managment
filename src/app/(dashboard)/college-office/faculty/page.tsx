"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import { DESIGNATION_LABELS } from "@/types";
import type { FacultyMember, Designation } from "@/types";

import { ResearchMatchChips, SeatBadges } from "@/components/faculty/facultyListCells";
import { ResearchAreaFilter } from "@/components/faculty/ResearchAreaFilter";
import { filterByResearchArea } from "@/lib/faculty/researchAreas";

type FacultyRow = Record<string, unknown> & FacultyMember;

// College Office's own faculty list - unlike HOD's Faculty Register, this
// exists only to reach the Promotion & Salary editor per person (see
// [id]/promotion-salary/page.tsx). Office has no other reason to browse or
// edit the faculty roster.
export default function CollegeOfficeFacultyPage() {
  const router = useRouter();
  // Settings > Website Display Name > "Faculty lists": the list shows each person's Display Name (display only).
  const { nameFor } = useFacultyDisplayNames();
  const shownName = (row: { id?: unknown; userUid?: unknown } & Parameters<typeof facultyDisplayName>[0]) =>
    nameFor("facultyLists", { facultyId: row.id as string | undefined, uid: row.userUid as string | undefined }, facultyDisplayName(row));
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [researchFilter, setResearchFilter] = useState("");
  const [emailTarget, setEmailTarget] = useState<{ id: string; employeeId: string; name: string } | null>(null);

  useEffect(() => {
    fetch("/api/college/faculty?withSeats=1")
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

  const shownFaculty = useMemo(() => filterByResearchArea(faculty, researchFilter), [faculty, researchFilter]);

  const columns: Column<FacultyRow>[] = [
    {
      key: "name",
      header: "Faculty Member",
      render: (row) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={shownName(row)} photoUrl={row.profilePhotoUrl as string | undefined} size="sm" className="mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <p className="font-medium leading-tight">{shownName(row) || "-"}</p>
            <p className="text-xs text-muted-foreground">ID: {row.employeeId as string}</p>
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm">{DESIGNATION_LABELS[row.designation as Designation] ?? (row.designation as string)}</p>
          <SeatBadges row={row} />
          <ResearchMatchChips row={row} />
        </div>
      ),
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
        data={shownFaculty}
        filterComponent={<ResearchAreaFilter faculty={faculty} value={researchFilter} onChange={setResearchFilter} />}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        onRowClick={(row) => router.push(`/college-office/faculty/${row.id}/promotion-salary`)}
        searchPlaceholder="Search by name, employee ID, role..."
        searchKeys={["legalName", "nameAsPerPan", "employeeId", "seatLabels"] as (keyof FacultyRow)[]}
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
