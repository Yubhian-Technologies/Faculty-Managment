"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { FacultyProfileHub } from "@/components/faculty/FacultyProfileHub";
import { toast } from "@/hooks/useToast";
import type { FacultyMember, UserRole } from "@/types";

// Only PRINCIPAL/DIRECTOR (the COLLEGE-scoped roles Super Admin edits) have
// rich enough data for the module-tile hub - every other Super-Admin-editable
// role (ACCOUNTS/FINANCE/PURCHASE_DEPT/ADMINISTRATION/MANAGEMENT) only supports
// photo + Module 6 - Others, so they skip straight to the flat edit page
// (see super-admin/users/[uid]/edit/page.tsx's non-college-scoped branch).
const HUB_ROLES: UserRole[] = ["PRINCIPAL", "DIRECTOR"];

export default function SuperAdminUserViewPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const searchParams = useSearchParams();
  const uid = params.uid;
  const collegeId = searchParams.get("collegeId") ?? "";
  const roleParam = (searchParams.get("role") ?? "") as UserRole | "";

  const [staff, setStaff] = useState<Partial<FacultyMember> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (roleParam && !HUB_ROLES.includes(roleParam)) {
      router.replace(`/super-admin/users/${uid}/edit?${searchParams.toString()}`);
      return;
    }
    fetch(`/api/admin/users/${uid}${collegeId ? `?collegeId=${collegeId}` : ""}`)
      .then((r) => r.json() as Promise<{ user?: Partial<FacultyMember>; error?: string }>)
      .then((d) => {
        if (!d.user) {
          toast({ variant: "destructive", title: d.error ?? "User not found" });
          router.push("/super-admin/users");
          return;
        }
        setStaff(d.user);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load user" }))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, collegeId, roleParam, router]);

  if (roleParam && !HUB_ROLES.includes(roleParam)) return null;
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!staff) return null;

  return (
    <FacultyProfileHub
      faculty={staff}
      basePath={`/super-admin/users/${uid}`}
      backHref="/super-admin/users"
      editHref={`/super-admin/users/${uid}/edit?${searchParams.toString()}`}
      hideFinancialModule
      excludeModules={["research", "teaching-load"]}
    />
  );
}
