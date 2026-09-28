"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SupportingStaffProfileHub } from "@/components/supportingStaff/SupportingStaffProfileHub";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import type { SupportingStaffMember } from "@/types";

// Also mounted at /principal/staff/non-technical/[id] and /library/staff/[id]
// (both re-exported from there) - listPath/basePath below pick the right
// destination for whichever route rendered this, same isCollegeLevel pattern
// as hod/faculty/new/page.tsx.
export default function NonTechnicalStaffViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const staffId = params.id;
  const user = useAuthStore((s) => s.user);
  const isCollegeLevel = user?.role === "PRINCIPAL" || user?.role === "VICE_PRINCIPAL";
  const isLibrary = user?.role === "LIBRARY";
  const listPath = isLibrary ? "/library/staff" : isCollegeLevel ? "/principal/staff" : "/college-office/non-technical-staff";
  const detailBasePath = isLibrary ? "/library/staff" : isCollegeLevel ? "/principal/staff/non-technical" : "/college-office/non-technical-staff";

  const [staff, setStaff] = useState<Partial<SupportingStaffMember> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/college/supporting-staff/${staffId}`)
      .then((r) => r.json() as Promise<{ staff?: Partial<SupportingStaffMember>; error?: string }>)
      .then((d) => {
        if (!d.staff) {
          toast({ variant: "destructive", title: d.error ?? "Staff record not found" });
          router.push(listPath);
          return;
        }
        setStaff(d.staff);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setIsLoading(false));
  }, [staffId, router, listPath]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!staff) return null;

  return (
    <SupportingStaffProfileHub
      staff={staff}
      basePath={`${detailBasePath}/${staffId}`}
      backHref={listPath}
      editHref={`${detailBasePath}/${staffId}/edit`}
    />
  );
}
