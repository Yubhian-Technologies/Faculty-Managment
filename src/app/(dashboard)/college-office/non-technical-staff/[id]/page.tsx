"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SupportingStaffProfileHub } from "@/components/supportingStaff/SupportingStaffProfileHub";
import { toast } from "@/hooks/useToast";
import type { SupportingStaffMember } from "@/types";

export default function NonTechnicalStaffViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const staffId = params.id;

  const [staff, setStaff] = useState<Partial<SupportingStaffMember> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/college/supporting-staff/${staffId}`)
      .then((r) => r.json() as Promise<{ staff?: Partial<SupportingStaffMember>; error?: string }>)
      .then((d) => {
        if (!d.staff) {
          toast({ variant: "destructive", title: d.error ?? "Staff record not found" });
          router.push("/college-office/non-technical-staff");
          return;
        }
        setStaff(d.staff);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setIsLoading(false));
  }, [staffId, router]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!staff) return null;

  return (
    <SupportingStaffProfileHub
      staff={staff}
      basePath={`/college-office/non-technical-staff/${staffId}`}
      backHref="/college-office/non-technical-staff"
      editHref={`/college-office/non-technical-staff/${staffId}/edit`}
    />
  );
}
