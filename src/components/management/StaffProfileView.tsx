"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileHub } from "@/components/faculty/FacultyProfileHub";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import type { FacultyMember, UserRole, College, ResearchPublication } from "@/types";

interface Props {
  collegeId: string;
  role: Extract<UserRole, "PRINCIPAL" | "VICE_PRINCIPAL" | "HOD">;
  title: string;
  department?: string;
  backHref: string;
}

// PRINCIPAL/VICE_PRINCIPAL have no FacultyMember record of their own (their
// academicProfile lives directly on the FMSUser doc - see AGENTS.md /
// principal/profile/[module]/page.tsx) - the `/staff` endpoint below returns
// that FMSUser shape, cast to Partial<FacultyMember> here since the two share
// every field FacultyProfileHub/FacultyProfileModuleContent actually read
// (same convention as principal/staff/[uid]/page.tsx).
function useManagementStaff(collegeId: string, role: Props["role"], department?: string) {
  return useQuery({
    queryKey: ["mgmt-staff", collegeId, role, department],
    queryFn: () => {
      const qs = new URLSearchParams({ role, ...(department ? { department } : {}) });
      return fetch(`/api/management/colleges/${collegeId}/staff?${qs}`)
        .then((r) => r.json() as Promise<{ profile: Partial<FacultyMember> | null; publications?: ResearchPublication[] }>);
    },
  });
}

function staffBasePath(collegeId: string, role: Props["role"]) {
  const segment = role === "PRINCIPAL" ? "principal" : role === "VICE_PRINCIPAL" ? "vice-principal" : "hod";
  return `/management/faculty/${collegeId}/${segment}`;
}

// Landing page for Principal/Vice Principal/HOD details under Management -
// identity summary + one tile per module (Personal, Academic Qualification,
// Research, ...), same FacultyProfileHub every other role's faculty/staff
// detail page uses, instead of one long scroll of every module dumped flat.
// Read-only (no editHref) - Management never edits these records.
export function StaffProfileView({ collegeId, role, title, department, backHref }: Props) {
  const router = useRouter();
  const { data, isLoading } = useManagementStaff(collegeId, role, department);
  const profile = data?.profile;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} actions={<Button variant="outline" onClick={() => router.push(backHref)}><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} actions={<Button variant="outline" onClick={() => router.push(backHref)}><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>} />
        <p className="text-sm text-muted-foreground">No {title.toLowerCase()} is currently assigned.</p>
      </div>
    );
  }

  return (
    <FacultyProfileHub
      faculty={profile}
      basePath={staffBasePath(collegeId, role)}
      backHref={backHref}
      // Principal/Vice Principal don't carry a teaching load - HOD does.
      excludeModules={role === "HOD" ? [] : ["teaching-load"]}
    />
  );
}

// Counterpart to StaffProfileView for the per-module tile pages
// (/management/faculty/[collegeId]/principal/[module], .../vice-principal/[module]).
export function StaffProfileModuleView({ collegeId, role, department, backHref }: Omit<Props, "title">) {
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];

  const { data, isLoading } = useManagementStaff(collegeId, role, department);
  const profile = data?.profile;
  const publications = data?.publications;

  const { data: collegeData } = useQuery({
    queryKey: ["mgmt-college-type", collegeId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}`)
        .then((r) => r.json() as Promise<{ college?: College }>),
  });
  const collegeType = collegeData?.college?.type;

  if (!moduleDef) {
    return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={profile?.name}
        actions={
          <Button variant="outline" asChild>
            <Link href={backHref}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : profile ? (
        <FacultyProfileModuleContent
          moduleKey={moduleKey}
          faculty={profile}
          collegeType={collegeType}
          publications={publications}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No profile on record.</p>
      )}
    </div>
  );
}
