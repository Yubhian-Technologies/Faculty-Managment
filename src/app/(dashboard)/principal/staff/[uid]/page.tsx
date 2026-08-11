"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FacultyProfileHub } from "@/components/faculty/FacultyProfileHub";
import { toast } from "@/hooks/useToast";
import type { FacultyMember } from "@/types";

export default function PrincipalStaffViewPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const uid = params.uid;

  const [staff, setStaff] = useState<Partial<FacultyMember> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/college/users/${uid}`)
      .then((r) => r.json() as Promise<{ user?: Partial<FacultyMember>; error?: string }>)
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

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!staff) return null;

  return (
    <FacultyProfileHub
      faculty={staff}
      basePath={`/principal/staff/${uid}`}
      backHref="/principal/staff"
      editHref={`/principal/staff/${uid}/edit`}
      hideFinancialModule
      excludeModules={["research", "teaching-load"]}
    />
  );
}
