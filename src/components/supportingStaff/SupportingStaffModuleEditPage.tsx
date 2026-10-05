"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SupportingStaffModuleEditor, type SupportingStaffEditRecord } from "@/components/supportingStaff/SupportingStaffModuleEditor";
import { getMissingRequiredPersonalFields, SUPPORTING_STAFF_REQUIRED_PERSONAL_FIELDS } from "@/components/shared/PersonalDetailsFields";
import { SUPPORTING_STAFF_MODULES, type SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import { supportingStaffModulePatchBody, supportingStaffRecordFromDoc } from "@/lib/supportingStaff/moduleRecord";

interface Props {
  // Where this staff category's own list/detail pages live - the only thing
  // that ever differed between the Technical (HOD) and Non-Technical
  // (College Office/Principal) copies of this page: load-fail redirect,
  // Back link, Cancel, and the after-save redirect all point at
  // `${basePath}/{staffId}/{moduleKey}`.
  basePath: string;
}

// Edits one Supporting Staff profile module (Qualifications, Job
// Responsibilities & Skills, Training, Achievements, or Personal Details) -
// shared by every Supporting Staff route family (HOD's Technical, College
// Office's/Principal's Non-Technical). Was three near-identical page files
// differing only in `basePath` (see each route's own thin wrapper).
export function SupportingStaffModuleEditPage({ basePath }: Props) {
  const router = useRouter();
  const params = useParams<{ id: string; module: string }>();
  const staffId = params.id;
  const moduleKey = params.module as SupportingStaffModuleKey;
  const moduleDef = SUPPORTING_STAFF_MODULES[moduleKey];
  const { collegeType } = useCollegeType();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<SupportingStaffEditRecord>({});

  useEffect(() => {
    fetch(`/api/college/supporting-staff/${staffId}`)
      .then((r) => r.json() as Promise<{ staff?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.staff) {
          toast({ variant: "destructive", title: data.error ?? "Staff record not found" });
          router.push(basePath);
          return;
        }
        setRecord(supportingStaffRecordFromDoc(data.staff));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setLoading(false));
  }, [staffId, router, basePath]);

  function patch(next: Partial<SupportingStaffEditRecord>) {
    setRecord((r) => ({ ...r, ...next }));
  }

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
      const body = supportingStaffModulePatchBody(moduleKey, record);

      const res = await fetch(`/api/college/supporting-staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      toast({ variant: "success", title: "Saved" });
      router.push(`${basePath}/${staffId}/${moduleKey}`);
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${moduleDef.label}`}
        description={supportingStaffDisplayName(record)}
        actions={
          <Button variant="outline" asChild>
            <Link href={`${basePath}/${staffId}/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <SupportingStaffModuleEditor
              moduleKey={moduleKey}
              record={record}
              onChange={patch}
              collegeType={collegeType}
            />
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => router.push(`${basePath}/${staffId}/${moduleKey}`)}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
