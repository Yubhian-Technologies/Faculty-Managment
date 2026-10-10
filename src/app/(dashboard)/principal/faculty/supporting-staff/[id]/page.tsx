"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { SupportingStaffProfileHub } from "@/components/supportingStaff/SupportingStaffProfileHub";
import { toast } from "@/hooks/useToast";
import { LIST_BACK_PARAM, resolveListBack } from "@/lib/listReturn";
import type { SupportingStaffMember } from "@/types";

// Read-only profile: no editHref, so the hub renders no Edit button, and no
// edit route exists under /principal/faculty/supporting-staff. The record is
// the full supportingStaff document - the same one the HOD and College Office
// views load - so every field the profile hub shows is present.
export default function PrincipalSupportingStaffProfilePage() {
  const router = useRouter();
  const { id: staffId } = useParams<{ id: string }>();
  // The Supporting Staff list as this profile was opened from it (category tab).
  const listHref = resolveListBack(useSearchParams(), "/principal/faculty/supporting-staff");

  const [staff, setStaff] = useState<Partial<SupportingStaffMember> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/college/supporting-staff/${staffId}`)
      .then((r) => r.json() as Promise<{ staff?: Partial<SupportingStaffMember>; error?: string }>)
      .then((d) => {
        if (!d.staff) {
          toast({ variant: "destructive", title: d.error ?? "Staff record not found" });
          router.push(listHref);
          return;
        }
        setStaff(d.staff);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setIsLoading(false));
  }, [staffId, router, listHref]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!staff) return null;

  return (
    <SupportingStaffProfileHub
      staff={staff}
      basePath={`/principal/faculty/supporting-staff/${staffId}`}
      backHref={listHref}
      linkQuery={listHref !== "/principal/faculty/supporting-staff" ? `?${LIST_BACK_PARAM}=${encodeURIComponent(listHref)}` : ""}
    />
  );
}
