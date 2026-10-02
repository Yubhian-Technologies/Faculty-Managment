"use client";

import { useParams, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageEditor } from "@/components/customNav/PageEditor";

export default function EditCustomPage() {
  const { id } = useParams<{ id: string }>();
  const collegeId = useSearchParams().get("collegeId") ?? "";
  return (
    <div className="space-y-6">
      <PageHeader title="Edit page" description="Build the page this tab opens from simple blocks." />
      {collegeId ? <PageEditor collegeId={collegeId} pageId={id} /> : <p className="text-sm text-destructive">Missing college. Open this page from Customise Dashboards.</p>}
    </div>
  );
}
