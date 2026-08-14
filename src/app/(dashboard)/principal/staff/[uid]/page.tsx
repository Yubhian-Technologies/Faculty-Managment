"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FacultyProfileHub } from "@/components/faculty/FacultyProfileHub";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { FacultyMember, UserRole } from "@/types";

type StaffAccount = Partial<FacultyMember> & { role?: UserRole };

export default function PrincipalStaffViewPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const uid = params.uid;

  const [staff, setStaff] = useState<StaffAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingReRegister, setConfirmingReRegister] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    fetch(`/api/college/users/${uid}`)
      .then((r) => r.json() as Promise<{ user?: StaffAccount; error?: string }>)
      .then((d) => {
        if (!d.user) {
          toast({ variant: "destructive", title: d.error ?? "Staff account not found" });
          router.push("/principal/staff");
          return;
        }
        setStaff(d.user);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff account" }))
      .finally(() => setIsLoading(false));
  }, [uid, router]);

  // Only HOD/Vice Principal have facial-attendance registration a Principal
  // is allowed to reset - mirrors HOD resetting Faculty one tier down (see
  // hod/faculty/[id]/page.tsx) and Management resetting Principal one tier up.
  const canResetFace = staff?.role === "HOD" || staff?.role === "VICE_PRINCIPAL";

  async function handleReRegisterFace() {
    setIsResetting(true);
    try {
      const res = await fetch("/api/college/attendance/face-registration/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to reset face registration" });
        return;
      }
      toast({ title: `${staff?.name ?? "Staff member"} can now register their face again from My Attendance` });
      setConfirmingReRegister(false);
    } catch {
      toast({ variant: "destructive", title: "Failed to reset face registration" });
    } finally {
      setIsResetting(false);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!staff) return null;

  return (
    <>
      <FacultyProfileHub
        faculty={staff}
        basePath={`/principal/staff/${uid}`}
        backHref="/principal/staff"
        editHref={`/principal/staff/${uid}/edit`}
        hideFinancialModule
        excludeModules={["research", "teaching-load"]}
        onReRegisterFace={canResetFace ? () => setConfirmingReRegister(true) : undefined}
      />

      {canResetFace && (
        <ConfirmDialog
          open={confirmingReRegister}
          onOpenChange={(open) => { if (!open) setConfirmingReRegister(false); }}
          title="Re-register face?"
          description={`${staff.name ?? "This staff member"}'s current registered face will stop working for check-in. They'll be prompted to register their face again the next time they open My Attendance.`}
          confirmLabel="Re-register Face"
          onConfirm={() => void handleReRegisterFace()}
          loading={isResetting}
        />
      )}
    </>
  );
}
