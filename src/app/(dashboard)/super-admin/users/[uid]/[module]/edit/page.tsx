"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleEditor, type FacultyEditRecord } from "@/components/faculty/FacultyProfileModuleEditor";
import { PROFILE_MODULES, SELF_EDIT_DISABLED_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { toast } from "@/hooks/useToast";
import type { College, CollegeType } from "@/types";

// research/financial are excluded from the hub entirely for this flow (see
// super-admin/users/[uid]/page.tsx) - this guard is defense-in-depth against
// someone navigating here directly by URL.
export default function SuperAdminUserModuleEditPage() {
  const router = useRouter();
  const params = useParams<{ uid: string; module: string }>();
  const uid = params.uid;
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [collegeType, setCollegeType] = useState<CollegeType | undefined>(undefined);
  const [record, setRecord] = useState<FacultyEditRecord>({});

  useEffect(() => {
    fetch(`/api/admin/users/${uid}`)
      .then((r) => r.json() as Promise<{ user?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.user) {
          toast({ variant: "destructive", title: data.error ?? "User not found" });
          router.push("/super-admin/users");
          return;
        }
        const m = data.user;
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
          academicProfile: (m.academicProfile as FacultyEditRecord["academicProfile"]) ?? {},
        });
        const collegeId = m.collegeId as string | undefined;
        if (collegeId) {
          fetch("/api/admin/colleges")
            .then((r) => r.json() as Promise<{ colleges?: College[] }>)
            .then((c) => setCollegeType(c.colleges?.find((x) => x.id === collegeId)?.type))
            .catch(() => {});
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load user" }))
      .finally(() => setLoading(false));
  }, [uid, router]);

  function patch(next: Partial<FacultyEditRecord>) {
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
          : { academicProfile: record.academicProfile };

      const res = await fetch(`/api/admin/users/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      toast({ variant: "success", title: "Saved" });
      router.push(`/super-admin/users/${uid}/${moduleKey}`);
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  if (SELF_EDIT_DISABLED_MODULES.includes(moduleKey)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`Edit ${moduleDef.label}`}
          description={name}
          actions={
            <Button variant="outline" asChild>
              <Link href={`/super-admin/users/${uid}/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
          }
        />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">This section isn&apos;t editable here.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${moduleDef.label}`}
        description={name}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/super-admin/users/${uid}/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <FacultyProfileModuleEditor
              moduleKey={moduleKey}
              record={record}
              onChange={patch}
              facultyId={uid}
              includeTeachingAssignment={false}
              collegeType={collegeType}
            />
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => router.push(`/super-admin/users/${uid}/${moduleKey}`)}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
