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
import { toast } from "@/hooks/useToast";

// Principal/VP have no FacultyMember record - seeds directly from useAuth()'s
// user (same source their View side already uses), PATCHes /api/college/users/me.
export default function PrincipalProfileModuleEditPage() {
  const router = useRouter();
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);

  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<FacultyEditRecord>({});

  useEffect(() => {
    if (!user) return;
    setRecord({
      gender: user.gender ?? "",
      dateOfBirth: user.dateOfBirth as never,
      legalName: user.legalName ?? "",
      fatherName: user.fatherName ?? "",
      motherName: user.motherName ?? "",
      religion: user.religion,
      caste: user.caste,
      subCaste: user.subCaste ?? "",
      aadharNo: user.aadharNo ?? "",
      panNo: user.panNo ?? "",
      passportNumber: user.passportNumber ?? "",
      emergencyContactName: user.emergencyContactName ?? "",
      emergencyContactPhone: user.emergencyContactPhone ?? "",
      ratificationStatus: user.ratificationStatus ?? "",
      ratificationDate: user.ratificationDate as never,
      maritalStatus: user.maritalStatus ?? "",
      spouseName: user.spouseName ?? "",
      numberOfChildren: user.numberOfChildren,
      referral: user.referral ?? "",
      nativePlace: user.nativePlace ?? "",
      temporaryAddress: user.temporaryAddress ?? "",
      permanentSameAsTemporary: user.permanentSameAsTemporary ?? false,
      permanentAddress: user.permanentAddress ?? "",
      bloodGroup: user.bloodGroup ?? "",
      academicProfile: user.academicProfile ?? {},
    });
  }, [user]);

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

      const res = await fetch("/api/college/users/me", {
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
      router.push(`/principal/profile/${moduleKey}`);
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  if (!user || !moduleDef) return <p className="text-sm text-muted-foreground">{!user ? "Loading…" : "Unknown section."}</p>;

  if (SELF_EDIT_DISABLED_MODULES.includes(moduleKey)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`Edit ${moduleDef.label}`}
          actions={
            <Button variant="outline" asChild>
              <Link href={`/principal/profile/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
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
            <Link href={`/principal/profile/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6 space-y-6">
          <FacultyProfileModuleEditor
            moduleKey={moduleKey}
            record={record}
            onChange={patch}
            facultyId={user.uid}
            includeTeachingAssignment={false}
          />
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => router.push(`/principal/profile/${moduleKey}`)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Save Changes</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
