"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AcademicProfileFields } from "@/components/faculty/AcademicProfileFields";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";
import { ROLE_LABELS } from "@/types";
import type { Department, FacultyProfileFields, UserRole } from "@/types";

export default function EditStaffPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const uid = params.uid;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<UserRole | "">("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((data) => setDepartments(data.departments ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/college/users/${uid}`)
      .then((r) => r.json() as Promise<{ user?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.user) {
          toast({ variant: "destructive", title: data.error ?? "Staff member not found" });
          router.push("/principal/staff");
          return;
        }
        const u = data.user;
        setRole((u.role as UserRole) ?? "");
        setEmail((u.email as string) ?? "");
        setName((u.name as string) ?? "");
        setPhone((u.phone as string) ?? "");
        setDepartment((u.department as string) ?? "");
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
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff member" }))
      .finally(() => setLoading(false));
  }, [uid, router]);

  const showAcademicProfile = role === "VICE_PRINCIPAL" || role === "HOD";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name is required" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/college/users/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          department,
          ...personalDetails,
          ...(showAcademicProfile ? { academicProfile } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Staff member updated" });
      router.push("/principal/staff");
    } catch {
      toast({ variant: "destructive", title: "Failed to update staff member" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit Staff Member" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Edit Staff Member"
        description={email}
        actions={role ? <Badge variant="outline">{ROLE_LABELS[role]}</Badge> : undefined}
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Account Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Ramesh Kumar" />
            </div>

            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>

            {role === "HOD" && (
              <div className="space-y-2">
                <Label>Department</Label>
                {departments.length > 0 ? (
                  <Select value={department} onValueChange={setDepartment}>
                    <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.name}>{d.name} ({d.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Department" />
                )}
              </div>
            )}

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
            <AcademicProfileFields
              value={academicProfile}
              onChange={setAcademicProfile}
              includeTeachingAssignment={role === "HOD"}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
