"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
};

export default function EditStaffPage() {
  const params = useParams<{ uid: string }>();
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [collegeEmail, setCollegeEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch(`/api/college/users/${params.uid}`).then((r) => r.json() as Promise<{ user?: StaffUser; error?: string }>),
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
    ])
      .then(([userData, deptData]) => {
        if (!userData.user) throw new Error(userData.error ?? "Not found");
        setUser(userData.user);
        setName(userData.user.name ?? "");
        setEmail(userData.user.email ?? "");
        setCollegeEmail(userData.user.collegeEmail ?? "");
        setEmployeeId(userData.user.employeeId ?? "");
        setPhone(userData.user.phone ?? "");
        setDepartment(userData.user.department ?? "");
        setDepartments((deptData.departments ?? []).filter((d) => d.isActive));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff member" }))
      .finally(() => setIsLoading(false));
  }, [params.uid]);

  const isValid = !!name.trim() && !!email.trim() && (user?.role !== "HOD" || !!department);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !isValid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/college/users/${user.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          collegeEmail: collegeEmail.trim(),
          employeeId: employeeId.trim(),
          phone: phone.trim(),
          ...(user.role === "HOD" ? { department } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: "Failed to update", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Staff member updated" });
      router.push("/principal/staff");
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />;
  }
  if (!user) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/principal/staff")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Staff
        </Button>
        <p className="text-sm text-muted-foreground">Staff member not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.push("/principal/staff")}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Staff
      </Button>
      <PageHeader title="Edit Staff" description={`${ROLE_LABELS[user.role]} account details`} />
      <Card>
        <CardHeader><CardTitle className="text-base">Staff Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {user.role === "HOD" && (
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
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.push("/principal/staff")}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!isValid}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
