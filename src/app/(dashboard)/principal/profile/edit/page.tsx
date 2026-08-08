"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AcademicProfileFields } from "@/components/faculty/AcademicProfileFields";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";
import { getUserById } from "@/lib/firestore/users";
import type { FacultyProfileFields } from "@/types";

export default function EditPrincipalProfilePage() {
  const router = useRouter();
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [collegeEmail, setCollegeEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? "");
    setEmail(user.email ?? "");
    setCollegeEmail(user.collegeEmail ?? "");
    setEmployeeId(user.employeeId ?? "");
    setPhone(user.phone ?? "");
    setPhotoUrl(user.profilePhotoUrl || undefined);
    setAcademicProfile(user.academicProfile ?? {});
    setPersonalDetails({
      gender: user.gender ?? "",
      dateOfBirth: toDateInputValue(user.dateOfBirth),
      legalName: user.legalName ?? "",
      fatherName: user.fatherName ?? "",
      motherName: user.motherName ?? "",
      religion: user.religion ?? "",
      caste: user.caste ?? "",
      aadharNo: user.aadharNo ?? "",
      panNo: user.panNo ?? "",
      passportNumber: user.passportNumber ?? "",
      emergencyContactName: user.emergencyContactName ?? "",
      emergencyContactPhone: user.emergencyContactPhone ?? "",
      ratificationStatus: user.ratificationStatus ?? "",
      ratificationDate: toDateInputValue(user.ratificationDate),
      maritalStatus: user.maritalStatus ?? "",
      spouseName: user.spouseName ?? "",
      numberOfChildren: user.numberOfChildren,
      referral: user.referral ?? "",
      nativePlace: user.nativePlace ?? "",
      temporaryAddress: user.temporaryAddress ?? "",
      permanentSameAsTemporary: user.permanentSameAsTemporary ?? false,
      permanentAddress: user.permanentAddress ?? "",
      bloodGroup: user.bloodGroup ?? "",
    });
  }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name is required" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        name,
        email,
        collegeEmail,
        employeeId,
        phone,
        ...personalDetails,
        academicProfile,
        ...(photoUrl !== undefined ? { profilePhotoUrl: photoUrl } : {}),
      };
      const res = await fetch("/api/college/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      toast({ variant: "success", title: "Profile updated" });

      // Best-effort: refresh auth store so TopBar name/photo update immediately.
      // Re-fetch rather than hand-merge `body` into the store: `body` carries
      // dateOfBirth/ratificationDate as date-input strings for the form, while
      // FMSUser expects them as Firestore Timestamps. A stale client ID token
      // can make this direct Firestore read fail even though the write above
      // (server-side, admin-authenticated) already succeeded, so a failure
      // here must not be reported as an update failure.
      if (user) {
        try {
          const freshProfile = await getUserById(user.collegeId, user.uid);
          if (freshProfile) setUser(freshProfile);
        } catch {
          // non-fatal - profile was saved; TopBar catches up on next load
        }
      }
      router.push("/principal/profile");
    } catch {
      toast({ variant: "destructive", title: "Failed to update profile" });
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit Profile" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Edit Profile" description="Update your account and profile details" />

      <Card>
        <CardHeader><CardTitle className="text-base">Account Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                <Label>Profile Photo</Label>
                <AvatarUploadField name={name || "?"} photoUrl={photoUrl} targetId={user.uid} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl("")} />
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Full Name *</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Ramesh Kumar" />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="principal@personal.com" />
              </div>
              <div className="space-y-2">
                <Label>College Email</Label>
                <Input type="email" value={collegeEmail} onChange={(e) => setCollegeEmail(e.target.value)} placeholder="name@vishnu.edu.in" />
              </div>
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-001" />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
        <CardContent>
          <PersonalDetailsFields value={personalDetails} onChange={setPersonalDetails} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Academic Profile</CardTitle></CardHeader>
        <CardContent>
          <AcademicProfileFields
            value={academicProfile}
            onChange={setAcademicProfile}
            includeTeachingAssignment={false}
            hideFinancialModule
          />
        </CardContent>
      </Card>
    </div>
  );
}
