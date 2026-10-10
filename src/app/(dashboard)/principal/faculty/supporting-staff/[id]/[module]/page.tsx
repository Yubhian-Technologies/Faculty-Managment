"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { SupportingStaffModuleContent } from "@/components/supportingStaff/SupportingStaffModuleContent";
import { SUPPORTING_STAFF_MODULES, type SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { toast } from "@/hooks/useToast";
import { resolveListBack, withListBack } from "@/lib/listReturn";
import type { SupportingStaffMember } from "@/types";

// Read-only counterpart of hod/supporting-staff/[id]/[module]: same module
// content, no Edit button (and no edit route under this path).
export default function PrincipalSupportingStaffModulePage() {
  const router = useRouter();
  const params = useParams<{ id: string; module: string }>();
  const staffId = params.id;
  // The Supporting Staff list as this page was reached from (category tab).
  const listHref = resolveListBack(useSearchParams(), "/principal/faculty/supporting-staff");
  const moduleKey = params.module as SupportingStaffModuleKey;
  const moduleDef = SUPPORTING_STAFF_MODULES[moduleKey];

  const [staff, setStaff] = useState<Partial<SupportingStaffMember> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!moduleDef) return;
    fetch(`/api/college/supporting-staff/${staffId}`)
      .then((r) => r.json() as Promise<{ staff?: Partial<SupportingStaffMember> }>)
      .then((d) => {
        if (!d.staff) {
          toast({ variant: "destructive", title: "Staff record not found" });
          router.push(listHref);
          return;
        }
        setStaff(d.staff);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setIsLoading(false));
  }, [staffId, moduleDef, router, listHref]);

  if (!moduleDef) {
    return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={supportingStaffDisplayName(staff)}
        actions={
          <Button variant="outline" asChild>
            <Link href={withListBack(`/principal/faculty/supporting-staff/${staffId}`, listHref, "/principal/faculty/supporting-staff")}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : staff ? (
        <SupportingStaffModuleContent moduleKey={moduleKey} staff={staff} />
      ) : null}
    </div>
  );
}
