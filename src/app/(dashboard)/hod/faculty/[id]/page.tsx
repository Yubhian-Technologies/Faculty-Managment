"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { FacultyProfileHub } from "@/components/faculty/FacultyProfileHub";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { toast } from "@/hooks/useToast";
import { LIST_BACK_PARAM, resolveListBack, withListBack } from "@/lib/listReturn";
import type { FacultyMember } from "@/types";

export default function HodFacultyViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const facultyId = params.id;
  // The Faculty Register as this profile was opened from (status tab, department).
  const listHref = resolveListBack(useSearchParams(), "/hod/faculty");

  const [faculty, setFaculty] = useState<FacultyMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingReRegister, setConfirmingReRegister] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    fetch(`/api/college/faculty/${facultyId}`)
      .then((r) => r.json() as Promise<{ faculty?: FacultyMember; error?: string }>)
      .then((d) => {
        if (!d.faculty) {
          toast({ variant: "destructive", title: "Faculty record not found" });
          router.push(listHref);
          return;
        }
        setFaculty(d.faculty);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty record" }))
      .finally(() => setIsLoading(false));
  }, [facultyId, router, listHref]);

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
  if (!faculty) return null;

  return (
    <>
      <FacultyProfileHub
        faculty={faculty}
        basePath={`/hod/faculty/${facultyId}`}
        backHref={listHref}
        linkQuery={listHref !== "/hod/faculty" ? `?${LIST_BACK_PARAM}=${encodeURIComponent(listHref)}` : ""}
        editHref={withListBack(`/hod/faculty/${facultyId}/edit`, listHref, "/hod/faculty")}
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
