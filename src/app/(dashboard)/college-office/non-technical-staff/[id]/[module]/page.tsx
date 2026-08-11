"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { SupportingStaffModuleContent } from "@/components/supportingStaff/SupportingStaffModuleContent";
import { SUPPORTING_STAFF_MODULES, type SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import { toast } from "@/hooks/useToast";
import type { SupportingStaffMember } from "@/types";

export default function NonTechnicalStaffModulePage() {
  const router = useRouter();
  const params = useParams<{ id: string; module: string }>();
  const staffId = params.id;
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
          router.push("/college-office/non-technical-staff");
          return;
        }
        setStaff(d.staff);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setIsLoading(false));
  }, [staffId, moduleDef, router]);

  if (!moduleDef) {
    return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={staff?.name}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/college-office/non-technical-staff/${staffId}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            <Button asChild>
              <Link href={`/college-office/non-technical-staff/${staffId}/${moduleKey}/edit`}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
            </Button>
          </div>
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
