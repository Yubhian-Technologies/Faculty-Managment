"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";
import { SupportingStaffModuleEditor, type SupportingStaffEditRecord } from "@/components/supportingStaff/SupportingStaffModuleEditor";
import { getMissingRequiredPersonalFields, SUPPORTING_STAFF_REQUIRED_PERSONAL_FIELDS } from "@/components/shared/PersonalDetailsFields";
import { SUPPORTING_STAFF_MODULES, type SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { supportingStaffModulePatchBody, supportingStaffRecordFromDoc } from "@/lib/supportingStaff/moduleRecord";
import { useOwnSupportingStaff } from "@/hooks/useOwnSupportingStaff";
import { useCollegeType } from "@/hooks/useCollegeType";
import type { SupportingStaffMember } from "@/types";
import { toast } from "@/hooks/useToast";

// Edits one section of a Supporting Staff member's OWN profile and saves it to their staff record
// (PATCH /api/college/supporting-staff/me) - the same sections, editor and save body their HOD / College Office
// uses, minus what only the managing role may change (the server drops those). A login with no linked staff record
// keeps the plain account editor it always had.
export default function CollegeStaffProfileModuleEditPage() {
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as SupportingStaffModuleKey;
  const { staff, loading } = useOwnSupportingStaff();

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!staff) return <MyProfileModuleEditPage basePath="/college-staff/profile" patchEndpoint="/api/college/users/me" />;
  if (!SUPPORTING_STAFF_MODULES[moduleKey]) return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  return <ModuleEditForm staff={staff} moduleKey={moduleKey} />;
}

function ModuleEditForm({ staff, moduleKey }: { staff: Partial<SupportingStaffMember>; moduleKey: SupportingStaffModuleKey }) {
  const router = useRouter();
  const moduleDef = SUPPORTING_STAFF_MODULES[moduleKey];
  const { collegeType } = useCollegeType();
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<SupportingStaffEditRecord>(() => supportingStaffRecordFromDoc(staff as Record<string, unknown>));

  const backHref = `/college-staff/profile/${moduleKey}`;

  async function handleSave() {
    if (moduleKey === "personal") {
      const missing = getMissingRequiredPersonalFields(record, SUPPORTING_STAFF_REQUIRED_PERSONAL_FIELDS);
      if (missing.length > 0) {
        toast({ variant: "destructive", title: "Some required fields are missing", description: missing.join(", ") });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/college/supporting-staff/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supportingStaffModulePatchBody(moduleKey, record)),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save");
      }
      toast({ variant: "success", title: "Saved" });
      router.push(backHref);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${moduleDef.label}`}
        description={supportingStaffDisplayName(staff)}
        actions={
          <Button variant="outline" asChild>
            <Link href={backHref}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6 space-y-6">
          <SupportingStaffModuleEditor
            moduleKey={moduleKey}
            record={record}
            onChange={(next) => setRecord((r) => ({ ...r, ...next }))}
            collegeType={collegeType}
          />
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => router.push(backHref)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Save Changes</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
