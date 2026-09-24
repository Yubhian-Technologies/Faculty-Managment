"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { UserRole } from "@/types";

// Every position of authority - College Admin, Academics, IQAC Coordinator, T&P,
// R&D, Placement Dept, Exam Cell, Library, HOD, Vice Principal - is a SEAT,
// not an account: create the person here with a plain login, then appoint
// them to the seat from Role Assignments (see types/roleSeats.ts). This form
// only ever creates the two roles that are genuinely just accounts.
// COLLEGE_STAFF is deliberately NOT here: a generic "College Staff" login
// (e.g. a Lab Assistant) created this way is only an account - it never gets
// a Supporting Staff profile record, so it never shows in the Supporting
// Staff lists. Non-teaching staff must be added via the Supporting Staff
// modules (HOD for Technical, "Add Non-Technical Staff" for Non-Technical),
// which create both the login and the profile record.
const CREATABLE_ROLES: UserRole[] = ["COLLEGE_OFFICE", "COLLEGE_ACCOUNTS"];

export default function NewStaffPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [collegeEmail, setCollegeEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("12345678");
  const [role, setRole] = useState<UserRole>("COLLEGE_OFFICE");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [saving, setSaving] = useState(false);

  const isValid = !!name.trim() && !!collegeEmail.trim() && !!password.trim() && !!role && !!dateOfJoining;

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
          collegeEmail: collegeEmail.trim(),
          password,
          role,
          dateOfJoining,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(employeeId.trim() ? { employeeId: employeeId.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
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
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Full Name <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-2">
                <Label>College Email <span className="text-destructive">*</span></Label>
                <Input type="email" value={collegeEmail} onChange={(e) => setCollegeEmail(e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="space-y-2">
                <Label>Personal Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
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
