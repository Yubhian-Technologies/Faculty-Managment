"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/authStore";
import { getUserById } from "@/lib/firestore/users";
import { FacultyProfileModuleEditor, type FacultyEditRecord } from "@/components/faculty/FacultyProfileModuleEditor";
import { PROFILE_MODULES, SELF_EDIT_DISABLED_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";

interface Props {
  basePath: string;       // e.g. "/hod/profile"
  patchEndpoint: string;  // "/api/college/users/me" | "/api/college/faculty/me"
}

// Shared self-profile per-module edit page for HOD and Panel (both source
// current values from GET /api/college/faculty/me, which falls back to the
// thin users/{uid} doc for roles with no FacultyMember record - see that
// route's comments). Principal/VP have their own edit page since their View
// side already bypasses this endpoint entirely (see principal/profile).
export function MyProfileModuleEditPage({ basePath, patchEndpoint }: Props) {
  const router = useRouter();
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);
  const { collegeType } = useCollegeType();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<FacultyEditRecord>({});

  useEffect(() => {
    fetch("/api/college/faculty/me")
      .then((r) => r.json() as Promise<{ faculty?: Record<string, unknown> | null }>)
      .then((d) => {
        const m = d.faculty ?? {};
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
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load profile" }))
      .finally(() => setLoading(false));
  }, []);

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

      const res = await fetch(patchEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      toast({ variant: "success", title: "Saved" });

      if (user) {
        try {
          const freshProfile = await getUserById(user.collegeId, user.uid);
          if (freshProfile) setUser(freshProfile);
        } catch {
          // non-fatal - profile was saved; TopBar catches up on next load
        }
      }
      router.push(`${basePath}/${moduleKey}`);
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
          actions={
            <Button variant="outline" asChild>
              <Link href={`${basePath}/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
          }
        />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">This section isn&apos;t self-editable.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${moduleDef.label}`}
        actions={
          <Button variant="outline" asChild>
            <Link href={`${basePath}/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
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
              facultyId={user?.uid ?? ""}
              includeTeachingAssignment={false}
              collegeType={collegeType}
            />
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => router.push(`${basePath}/${moduleKey}`)}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
