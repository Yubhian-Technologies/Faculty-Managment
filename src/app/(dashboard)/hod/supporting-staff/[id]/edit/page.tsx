"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SelectItem } from "@/components/ui/select";
import { SupportingStaffEditPage } from "@/components/supportingStaff/SupportingStaffEditPage";
import type { DesignationCatalogItem } from "@/types";

const LIST_PATH = "/hod/supporting-staff";

// Department isn't editable here - a Technical staff record stays owned by the department it was created in
// (server-enforced, see /api/college/supporting-staff/[id] PATCH's HOD scope check). The form itself - the same
// look and tabs as the Add wizard - is the shared SupportingStaffEditPage.
export default function EditHodSupportingStaffPage() {
  const params = useParams<{ id: string }>();
  const [designationOptions, setDesignationOptions] = useState<string[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/designations?category=TECHNICAL");
        const data = await res.json() as { items?: DesignationCatalogItem[] };
        setDesignationOptions((data.items ?? []).filter((d) => d.isActive).map((d) => d.name));
      } catch {
        // Non-fatal - the picker just stays empty until the admin's catalog loads.
      }
    })();
  }, []);

  return (
    <SupportingStaffEditPage
      staffId={params.id}
      title="Edit Supporting Staff"
      loadFailPath={LIST_PATH}
      backHref={LIST_PATH}
      backLabel="Back to Supporting Staff"
      afterSavePath={LIST_PATH}
      designationContent={designationOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
      departmentMode="locked"
      otherDesignationPlaceholder="e.g. Lab Technician"
    />
  );
}
