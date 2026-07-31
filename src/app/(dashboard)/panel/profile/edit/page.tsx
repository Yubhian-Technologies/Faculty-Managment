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
import type { FacultyProfileFields, FacultyMember } from "@/types";

type FacultyProfile = Partial<FacultyMember> & { id: string };

export default function EditFacultyProfilePage() {
  const router = useRouter();
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});

  useEffect(() => {
    fetch("/api/college/faculty/me")
      .then((r) => r.json() as Promise<{ faculty: FacultyProfile | null }>)
      .then(({ faculty }) => {
        if (!faculty) return;
        setName(faculty.name ?? "");
        setEmail(faculty.email ?? "");
        setPhone(faculty.phone ?? "");
        setPhotoUrl(faculty.profilePhotoUrl || undefined);
        setAcademicProfile(faculty.academicProfile ?? {});
        setPersonalDetails({
          gender: faculty.gender ?? "",
          dateOfBirth: toDateInputValue(faculty.dateOfBirth),
          legalName: faculty.legalName ?? "",
          fatherName: faculty.fatherName ?? "",
          motherName: faculty.motherName ?? "",
          religion: faculty.religion ?? "",
          caste: faculty.caste ?? "",
          aadharNo: faculty.aadharNo ?? "",
          panNo: faculty.panNo ?? "",
          passportNumber: faculty.passportNumber ?? "",
          emergencyContactName: faculty.emergencyContactName ?? "",
          emergencyContactPhone: faculty.emergencyContactPhone ?? "",
          ratificationStatus: faculty.ratificationStatus ?? "",
          ratificationDate: toDateInputValue(faculty.ratificationDate),
          maritalStatus: faculty.maritalStatus ?? "",
          spouseName: faculty.spouseName ?? "",
          numberOfChildren: faculty.numberOfChildren,
          referral: faculty.referral ?? "",
          nativePlace: faculty.nativePlace ?? "",
          temporaryAddress: faculty.temporaryAddress ?? "",
          permanentSameAsTemporary: faculty.permanentSameAsTemporary ?? false,
          permanentAddress: faculty.permanentAddress ?? "",
          bloodGroup: faculty.bloodGroup ?? "",
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load profile" }))
      .finally(() => setLoaded(true));
  }, []);

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
        phone,
        ...personalDetails,
        academicProfile,
        ...(photoUrl !== undefined ? { profilePhotoUrl: photoUrl } : {}),
      };
      const res = await fetch("/api/college/faculty/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      // Refresh auth store so TopBar name/photo update immediately
      if (user) {
        const freshProfile = await getUserById(user.collegeId, user.uid);
        if (freshProfile) setUser(freshProfile);
      }
      toast({ variant: "success", title: "Profile updated" });
      router.push("/panel/profile");
    } catch {
      toast({ variant: "destructive", title: "Failed to update profile" });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
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
                <AvatarUploadField
                  name={name || "?"}
                  photoUrl={photoUrl}
                  targetId={user?.uid ?? ""}
                  onUploaded={setPhotoUrl}
                  onDeleted={() => setPhotoUrl("")}
                />
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

            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" />
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
