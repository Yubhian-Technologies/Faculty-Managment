"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCollegeType } from "@/hooks/useCollegeType";
import { getCreatableOfficeRoles } from "@/lib/roles/officeRoles";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { Department, UserRole } from "@/types";

// Base roles every college type can create, plus whichever "internal
// office" roles (Dean/IQAC/T&P/R&D/Placement/Library/Exam Cell/Webmaster)
// apply to this college's type - see getCreatableOfficeRoles. Must match
// the same college-type gating in src/app/api/college/users/route.ts.
// COLLEGE_STAFF is deliberately NOT here: a generic "College Staff" login
// (e.g. a Lab Assistant) created this way is only an account - it never gets
// a Supporting Staff profile record, so it never shows in the Supporting
// Staff lists. Non-teaching staff must be added via the Supporting Staff
// modules (HOD for Technical, "Add Non-Technical Staff" for Non-Technical),
// which create both the login and the profile record.
const BASE_CREATABLE_ROLES: UserRole[] = ["HOD", "COLLEGE_OFFICE", "VICE_PRINCIPAL", "COLLEGE_ACCOUNTS"];

export default function NewStaffPage() {
  const router = useRouter();
  const { collegeType } = useCollegeType();
  // Placement Department is provisioned by Administration (see
  // administration/college-staff), not the Principal - so it's excluded here.
  const CREATABLE_ROLES: UserRole[] = [
    ...BASE_CREATABLE_ROLES,
    ...getCreatableOfficeRoles(collegeType).filter((r) => r !== "PLACEMENT_DEPT"),
  ];
  const [departments, setDepartments] = useState<Department[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [collegeEmail, setCollegeEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("12345678");
  const [role, setRole] = useState<UserRole>("COLLEGE_OFFICE");
  const [department, setDepartment] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).filter((dep) => dep.isActive)))
      .catch(() => { /* only needed for the HOD department picker */ });
  }, []);

  const isValid = !!name.trim() && !!email.trim() && !!password.trim() && !!role && !!dateOfJoining &&
    (role !== "HOD" || !!department);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          dateOfJoining,
          ...(collegeEmail.trim() ? { collegeEmail: collegeEmail.trim() } : {}),
          ...(employeeId.trim() ? { employeeId: employeeId.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(role === "HOD" ? { department } : {}),
        }),
      });
      const json = await res.json() as { uid?: string; error?: string };
      if (res.status === 409) {
        toast({ variant: "destructive", title: json.error ?? "Already exists" });
        return;
      }
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create", description: json.error });
        return;
      }
      toast({ variant: "success", title: `${ROLE_LABELS[role]} account created` });
      router.push("/principal/staff");
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Add Staff" description="Create a staff login for your college" />
      <Card>
        <CardHeader><CardTitle className="text-base">Staff Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Role <span className="text-destructive">*</span></Label>
              <Select value={role} onValueChange={(v) => { setRole(v as UserRole); setDepartment(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREATABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {role === "HOD" && (
              <div className="space-y-2">
                <Label>Department <span className="text-destructive">*</span></Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">No departments found - ask Principal to add one under Departments</div>
                    ) : (
                      departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}


            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Full Name <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              </div>
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
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Temporary Password <span className="text-destructive">*</span></Label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Date of Joining <span className="text-destructive">*</span></Label>
                <Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!isValid}>Create Account</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
