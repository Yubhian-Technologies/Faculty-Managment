"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SupportingStaffModuleEditor, type SupportingStaffEditRecord } from "@/components/supportingStaff/SupportingStaffModuleEditor";
import { SUPPORTING_STAFF_MODULES, type SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";

export default function NonTechnicalStaffModuleEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; module: string }>();
  const staffId = params.id;
  const moduleKey = params.module as SupportingStaffModuleKey;
  const moduleDef = SUPPORTING_STAFF_MODULES[moduleKey];
  const { collegeType } = useCollegeType();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [record, setRecord] = useState<SupportingStaffEditRecord>({});

  useEffect(() => {
    fetch(`/api/college/supporting-staff/${staffId}`)
      .then((r) => r.json() as Promise<{ staff?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.staff) {
          toast({ variant: "destructive", title: data.error ?? "Staff record not found" });
          router.push("/college-office/non-technical-staff");
          return;
        }
        const m = data.staff;
        setName((m.name as string) ?? "");
        setRecord({
          gender: (m.gender as string) ?? "",
          dateOfBirth: (m.dateOfBirth as string) ?? undefined,
          legalName: (m.legalName as string) ?? "",
          fatherName: (m.fatherName as string) ?? "",
          motherName: (m.motherName as string) ?? "",
          religion: m.religion as never,
          caste: m.caste as never,
          subCaste: (m.subCaste as string) ?? "",
          aadharNo: (m.aadharNo as string) ?? "",
          panNo: (m.panNo as string) ?? "",
          passportNumber: (m.passportNumber as string) ?? "",
          emergencyContactName: (m.emergencyContactName as string) ?? "",
          emergencyContactPhone: (m.emergencyContactPhone as string) ?? "",
          ratificationStatus: (m.ratificationStatus as string) ?? "",
          ratificationDate: (m.ratificationDate as string) ?? undefined,
          maritalStatus: (m.maritalStatus as string) ?? "",
          spouseName: (m.spouseName as string) ?? "",
          numberOfChildren: m.numberOfChildren as number | undefined,
          referral: (m.referral as string) ?? "",
          nativePlace: (m.nativePlace as string) ?? "",
          temporaryAddress: (m.temporaryAddress as string) ?? "",
          permanentSameAsTemporary: (m.permanentSameAsTemporary as boolean) ?? false,
          permanentAddress: (m.permanentAddress as string) ?? "",
          bloodGroup: (m.bloodGroup as string) ?? "",
          supportingStaffProfile: (m.supportingStaffProfile as SupportingStaffEditRecord["supportingStaffProfile"]) ?? {},
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setLoading(false));
  }, [staffId, router]);

  function patch(next: Partial<SupportingStaffEditRecord>) {
    setRecord((r) => ({ ...r, ...next }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> =
        moduleKey === "personal"
          ? {
              gender: record.gender, dateOfBirth: record.dateOfBirth, legalName: record.legalName,
              fatherName: record.fatherName, motherName: record.motherName, religion: record.religion,
              caste: record.caste, subCaste: record.subCaste, aadharNo: record.aadharNo, panNo: record.panNo,
              passportNumber: record.passportNumber, emergencyContactName: record.emergencyContactName,
              emergencyContactPhone: record.emergencyContactPhone, ratificationStatus: record.ratificationStatus,
              ratificationDate: record.ratificationDate, maritalStatus: record.maritalStatus, spouseName: record.spouseName,
              numberOfChildren: record.numberOfChildren, referral: record.referral, nativePlace: record.nativePlace,
              temporaryAddress: record.temporaryAddress, permanentSameAsTemporary: record.permanentSameAsTemporary,
              permanentAddress: record.permanentAddress, bloodGroup: record.bloodGroup,
            }
          : { supportingStaffProfile: record.supportingStaffProfile };

      const res = await fetch(`/api/college/supporting-staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      toast({ variant: "success", title: "Saved" });
      router.push(`/college-office/non-technical-staff/${staffId}/${moduleKey}`);
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
        description={name}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/college-office/non-technical-staff/${staffId}/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
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
              <Button variant="outline" onClick={() => router.push(`/college-office/non-technical-staff/${staffId}/${moduleKey}`)}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
