"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { Department, UserRole } from "@/types";

// Roles a Principal/VP can create here - must match PRINCIPAL_ROLES in
// src/app/api/college/users/route.ts.
const CREATABLE_ROLES: UserRole[] = [
  "HOD", "COLLEGE_OFFICE", "VICE_PRINCIPAL", "COLLEGE_STAFF",
  "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
  "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER",
];

// One holder per college - matches COLLEGE_SINGLETON_ROLES on the API route.
const SINGLETON_ROLES: UserRole[] = ["PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER"];

export default function NewStaffPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [collegeEmail, setCollegeEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("12345678");
  const [role, setRole] = useState<UserRole>("COLLEGE_OFFICE");
  const [department, setDepartment] = useState("");
  const [designation, setDesignation] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).filter((dep) => dep.isActive)))
      .catch(() => { /* only needed for the HOD department picker */ });
  }, []);

  const isValid = !!name.trim() && !!email.trim() && !!password.trim() && !!role &&
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
          ...(collegeEmail.trim() ? { collegeEmail: collegeEmail.trim() } : {}),
          ...(employeeId.trim() ? { employeeId: employeeId.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(role === "HOD" ? { department } : {}),
          ...(role === "COLLEGE_STAFF" && designation.trim() ? { designation: designation.trim() } : {}),
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
              <Select value={role} onValueChange={(v) => { setRole(v as UserRole); setDepartment(""); setDesignation(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREATABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}{SINGLETON_ROLES.includes(r) ? " (one per college)" : ""}
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

            {role === "COLLEGE_STAFF" && (
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Dean - R&D, IQAC Coordinator" />
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
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Temporary Password <span className="text-destructive">*</span></Label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} />
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
