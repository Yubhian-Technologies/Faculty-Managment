"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { Department, UserRole } from "@/types";

type StaffUser = {
  uid: string;
  name: string;
  email: string;
  collegeEmail?: string;
  employeeId?: string;
  phone?: string;
  role: UserRole;
  department?: string;
  departments?: string[];
  designation?: string;
  profilePhotoUrl?: string;
} & Record<string, unknown>;

// Account-level fields only (identity/employment) - personal details and
// academic profile modules are edited from the view hub at /principal/staff/[uid]
// instead, one module at a time (see that page for the module tiles + constraints).
export default function EditStaffAccountPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const uid = params.uid;

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [collegeEmail, setCollegeEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [multiDepartments, setMultiDepartments] = useState<string[]>([]);
  const [designation, setDesignation] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).filter((dep) => dep.isActive)))
      .catch(() => { /* only needed for the HOD department picker */ });
  }, []);

  useEffect(() => {
    if (!uid) return;
    fetch(`/api/college/users/${uid}`)
      .then((r) => r.json() as Promise<{ user?: StaffUser; error?: string }>)
      .then(({ user }) => {
        if (!user) {
          toast({ variant: "destructive", title: "Staff account not found" });
          router.push("/principal/staff");
          return;
        }
        setRole(user.role);
        setName(user.name ?? "");
        setEmail(user.email ?? "");
        setCollegeEmail(user.collegeEmail ?? "");
        setEmployeeId(user.employeeId ?? "");
        setPhone(user.phone ?? "");
        setDepartment(user.department ?? "");
        setMultiDepartments(user.departments ?? []);
        setDesignation(user.designation ?? "");
        setPhotoUrl(user.profilePhotoUrl || undefined);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff account" }))
      .finally(() => setLoaded(true));
  }, [uid, router]);

  const isMultiDepartment = multiDepartments.length > 1;
  const isValid = !!name.trim() && !!email.trim() && (role !== "HOD" || isMultiDepartment || !!department);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/college/users/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          collegeEmail: collegeEmail.trim(),
          employeeId: employeeId.trim(),
          phone: phone.trim(),
          ...(role === "HOD" && !isMultiDepartment ? { department } : {}),
          ...(role === "COLLEGE_STAFF" ? { designation } : {}),
          ...(photoUrl !== undefined ? { profilePhotoUrl: photoUrl } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to update staff account" });
        return;
      }
      toast({ variant: "success", title: "Staff account updated" });
      router.push(`/principal/staff/${uid}`);
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded || !role) {
    return (
      <div className="max-w-xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/principal/staff/${uid}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <PageHeader title="Edit Staff Member" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.push(`/principal/staff/${uid}`)}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back
      </Button>
      <PageHeader title={`Edit ${ROLE_LABELS[role]}`} description="Update this staff member's account details" />

      <Card>
        <CardHeader><CardTitle className="text-base">Account Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                <Label>Profile Photo</Label>
                <AvatarUploadField name={name || "?"} photoUrl={photoUrl} targetId={uid} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl("")} />
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Full Name <span className="text-destructive">*</span></Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Email <span className="text-destructive">*</span></Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@vishnu.edu.in" />
              </div>
              <div className="space-y-2">
                <Label>College Email</Label>
                <Input type="email" value={collegeEmail} onChange={(e) => setCollegeEmail(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="Optional" />
              </div>
              {role === "HOD" && isMultiDepartment && (
                <div className="space-y-2">
                  <Label>Departments</Label>
                  <p className="text-sm text-muted-foreground pt-2">
                    {multiDepartments.join(", ")} — manage from the{" "}
                    <Link href="/principal/departments" className="underline">Departments page</Link>.
                  </p>
                </div>
              )}
              {role === "HOD" && !isMultiDepartment && (
                <div className="space-y-2">
                  <Label>Department <span className="text-destructive">*</span></Label>
                  <Select value={department} onValueChange={setDepartment}>
                    <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {role === "COLLEGE_STAFF" && (
                <div className="space-y-2">
                  <Label>Designation</Label>
                  <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Dean - R&D, IQAC Coordinator" />
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.push(`/principal/staff/${uid}`)}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!isValid}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
