"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AcademicProfileFields } from "@/components/faculty/AcademicProfileFields";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";
import { ROLE_LABELS } from "@/types";
import type { FacultyProfileFields, UserRole } from "@/types";

const ASSIGNABLE_ROLES: UserRole[] = ["PRINCIPAL", "ACCOUNTS", "FINANCE", "PURCHASE_DEPT"];

export default function EditUserPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const searchParams = useSearchParams();
  const uid = params.uid;
  const collegeId = searchParams.get("collegeId") ?? "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("PRINCIPAL");
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});

  useEffect(() => {
    if (!collegeId) {
      toast({ variant: "destructive", title: "Missing college context" });
      router.push("/super-admin/users");
      return;
    }
    fetch(`/api/admin/users/${uid}?collegeId=${collegeId}`)
      .then((r) => r.json() as Promise<{ user?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.user) {
          toast({ variant: "destructive", title: data.error ?? "User not found" });
          router.push("/super-admin/users");
          return;
        }
        const u = data.user;
        setEmail((u.email as string) ?? "");
        setName((u.name as string) ?? "");
        setPhone((u.phone as string) ?? "");
        setRole((u.role as UserRole) ?? "PRINCIPAL");
        setAcademicProfile((u.academicProfile as Partial<FacultyProfileFields>) ?? {});
        setPersonalDetails({
          gender: (u.gender as string) ?? "",
          dateOfBirth: toDateInputValue(u.dateOfBirth as never),
          legalName: (u.legalName as string) ?? "",
          fatherName: (u.fatherName as string) ?? "",
          motherName: (u.motherName as string) ?? "",
          religion: (u.religion as string) ?? "",
          caste: (u.caste as string) ?? "",
          aadharNo: (u.aadharNo as string) ?? "",
          panNo: (u.panNo as string) ?? "",
          ratificationStatus: (u.ratificationStatus as string) ?? "",
          ratificationDate: toDateInputValue(u.ratificationDate as never),
          maritalStatus: (u.maritalStatus as string) ?? "",
          spouseName: (u.spouseName as string) ?? "",
          numberOfChildren: u.numberOfChildren as number | undefined,
          referral: (u.referral as string) ?? "",
          nativePlace: (u.nativePlace as string) ?? "",
          temporaryAddress: (u.temporaryAddress as string) ?? "",
          permanentSameAsTemporary: (u.permanentSameAsTemporary as boolean) ?? false,
          permanentAddress: (u.permanentAddress as string) ?? "",
          bloodGroup: (u.bloodGroup as string) ?? "",
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load user" }))
      .finally(() => setLoading(false));
  }, [uid, collegeId, router]);

  const showAcademicProfile = role === "PRINCIPAL";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name is required" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collegeId,
          name,
          phone,
          role,
          ...personalDetails,
          ...(showAcademicProfile ? { academicProfile } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "User updated" });
      router.push("/super-admin/users");
    } catch {
      toast({ variant: "destructive", title: "Failed to update user" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit User" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Edit User" description={email} />

      <Card>
        <CardHeader><CardTitle className="text-base">User Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone / WhatsApp" />
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

      {showAcademicProfile && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Academic Profile</CardTitle></CardHeader>
          <CardContent>
            <AcademicProfileFields value={academicProfile} onChange={setAcademicProfile} includeTeachingAssignment={false} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
