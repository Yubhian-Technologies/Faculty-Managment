"use client";

import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useReturnTo } from "@/hooks/useReturnTo";
import { RETURN_PARAM, withReturnTo } from "@/lib/faculty/returnTo";
import { FacultyProfileHub } from "@/components/faculty/FacultyProfileHub";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { toast } from "@/hooks/useToast";
import type { Department, FacultyMember } from "@/types";

function PrincipalFacultyProfileContent() {
  const returnTo = useReturnTo();
  const { deptId, facultyId } = useParams<{ deptId: string; facultyId: string }>();
  const [confirmingReRegister, setConfirmingReRegister] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const { data: faculty, isLoading } = useQuery({
    queryKey: ["principal-faculty-profile", facultyId],
    queryFn: () =>
      fetch(`/api/college/faculty/${facultyId}`)
        .then((r) => r.json() as Promise<{ faculty?: FacultyMember }>)
        .then((d) => d.faculty ?? null),
    // Edited from this page's own Edit routes - the app-wide 2-minute staleTime
    // would otherwise show the pre-edit record on the way back.
    refetchOnMount: "always",
  });

  const { data: departments } = useQuery({
    queryKey: ["departments-for-hierarchy"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });
  const parentDeptName = (() => {
    const dept = departments?.find((d) => d.name === faculty?.department);
    if (!dept?.parentDepartmentId) return null;
    return departments?.find((d) => d.id === dept.parentDepartmentId)?.name ?? null;
  })();

  // Same reset the HOD's own faculty detail page offers - the API already
  // accepts Principal/College Admin.
  async function handleReRegisterFace() {
    setIsResetting(true);
    try {
      const res = await fetch("/api/college/attendance/face-registration/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facultyId }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to reset face registration" });
        return;
      }
      toast({ title: `${facultyDisplayName(faculty) || "Faculty"} can now register their face again from My Attendance` });
      setConfirmingReRegister(false);
    } catch {
      toast({ variant: "destructive", title: "Failed to reset face registration" });
    } finally {
      setIsResetting(false);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!faculty) return <p className="text-sm text-muted-foreground">Faculty record not found.</p>;

  return (
    <>
      <FacultyProfileHub
        faculty={faculty}
        basePath={`/principal/faculty/${deptId}/${facultyId}`}
        backHref={returnTo ?? `/principal/faculty/${deptId}`}
        linkQuery={returnTo ? `?${RETURN_PARAM}=${encodeURIComponent(returnTo)}` : ""}
        editHref={withReturnTo(`/principal/faculty/${deptId}/${facultyId}/edit`, returnTo)}
        parentDeptName={parentDeptName}
        onReRegisterFace={() => setConfirmingReRegister(true)}
      />

      <ConfirmDialog
        open={confirmingReRegister}
        onOpenChange={(open) => { if (!open) setConfirmingReRegister(false); }}
        title="Re-register face?"
        description={`${facultyDisplayName(faculty) || "This faculty member"}'s current registered face will stop working for check-in. They'll be prompted to register their face again the next time they open My Attendance.`}
        confirmLabel="Re-register Face"
        onConfirm={() => void handleReRegisterFace()}
        loading={isResetting}
      />
    </>
  );
}

export default function PrincipalFacultyProfilePage() {
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}><PrincipalFacultyProfileContent /></Suspense>;
}
