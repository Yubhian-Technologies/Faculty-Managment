"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AcademicProfileFields } from "@/components/faculty/AcademicProfileFields";
import { ROLE_LABELS } from "@/types";
import { toast } from "@/hooks/useToast";
import type { College, Location, FacultyProfileFields } from "@/types";

const COLLEGE_ROLES = ["PRINCIPAL", "ACCOUNTS", "FINANCE"] as const;
const LOCATION_ROLES = ["ADMINISTRATION"] as const;
const GLOBAL_ROLES = ["MANAGEMENT"] as const;
const ALL_ROLES = [...COLLEGE_ROLES, ...LOCATION_ROLES, ...GLOBAL_ROLES] as const;

export default function NewUserPage() {
  const router = useRouter();
  const [colleges, setColleges] = useState<College[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("12345678");
  const [role, setRole] = useState<typeof ALL_ROLES[number]>("PRINCIPAL");
  const [collegeId, setCollegeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setColleges((d.colleges ?? []).filter((c) => c.isActive)))
      .catch(() => {});

    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((d) => setLocations((d.locations ?? []).filter((l) => l.isActive)))
      .catch(() => {});
  }, []);

  const isLocationRole = LOCATION_ROLES.includes(role as typeof LOCATION_ROLES[number]);
  const isGlobalRole = GLOBAL_ROLES.includes(role as typeof GLOBAL_ROLES[number]);
  const isValid = !!name && !!email && !!password && !!role &&
    (isGlobalRole ? true : isLocationRole ? !!locationId : !!collegeId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, email, password, role, collegeId, locationId, phone,
          ...(role === "PRINCIPAL" ? { academicProfile } : {}),
        }),
      });
      const json = await res.json() as { uid?: string; error?: string };
      if (res.status === 409) {
        toast({ variant: "destructive", title: "Email already in use" });
        return;
      }
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed", description: json.error });
        return;
      }
      toast({ variant: "success", title: "User created" });
      router.push("/super-admin/users");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Add User" description="Create a staff account and assign role" />
      <Card>
        <CardHeader><CardTitle className="text-base">User Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@vishnu.edu.in" />
            </div>
            <div className="space-y-2">
              <Label>Temporary Password <span className="text-destructive">*</span></Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Role <span className="text-destructive">*</span></Label>
                <Select value={role} onValueChange={(v) => { setRole(v as typeof ALL_ROLES[number]); setCollegeId(""); setLocationId(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isGlobalRole ? (
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone / WhatsApp" />
                </div>
              ) : isLocationRole ? (
                <div className="space-y-2">
                  <Label>Location <span className="text-destructive">*</span></Label>
                  <Select value={locationId} onValueChange={setLocationId}>
                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>College <span className="text-destructive">*</span></Label>
                  <Select value={collegeId} onValueChange={setCollegeId}>
                    <SelectTrigger><SelectValue placeholder="Select college" /></SelectTrigger>
                    <SelectContent>
                      {colleges.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!isValid}>Create User</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {role === "PRINCIPAL" && (
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
