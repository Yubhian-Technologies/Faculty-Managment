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
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";
import { ROLE_LABELS, ROLE_SCOPE } from "@/types";
import type { FacultyProfileFields, UserRole } from "@/types";

// The 6 roles Super Admin directly administers. Scope (COLLEGE/LOCATION/GLOBAL) is
// read from ROLE_SCOPE — a role's tenancy tier, not something re-declared here —
// so this stays correct as roles move between tiers (e.g. ACCOUNTS is LOCATION-
// scoped, FINANCE/PURCHASE_DEPT are GLOBAL-scoped; only PRINCIPAL is COLLEGE).
const SUPER_ADMIN_EDITABLE_ROLES: UserRole[] = ["PRINCIPAL", "ACCOUNTS", "FINANCE", "PURCHASE_DEPT", "ADMINISTRATION", "MANAGEMENT"];
// Role-reassignment dropdown only offers roles within the same (COLLEGE) tier —
// reassigning across tiers would move the profile doc to a different collection,
// which this page's PATCH route doesn't do.
const COLLEGE_SCOPE_ROLES: UserRole[] = SUPER_ADMIN_EDITABLE_ROLES.filter((r) => ROLE_SCOPE[r] === "COLLEGE");

export default function EditUserPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const searchParams = useSearchParams();
  const uid = params.uid;
  const collegeId = searchParams.get("collegeId") ?? "";
  const locationId = searchParams.get("locationId") ?? "";
  const roleParam = (searchParams.get("role") ?? "") as UserRole | "";
  // Gate on role membership first — HOD/PANEL_MEMBER/etc. share the COLLEGE scope
  // tier with PRINCIPAL but aren't Super-Admin-editable at all.
  const isEditableRole = roleParam !== "" && SUPER_ADMIN_EDITABLE_ROLES.includes(roleParam);
  const roleParamScope = isEditableRole ? ROLE_SCOPE[roleParam as UserRole] : undefined;

  // College-scoped roles have a full edit form; Location/Global-scoped roles
  // (Administration/Accounts, Management/Finance/Purchase) only get the photo and
  // Module 6 — Others (no PATCH route exists for their other fields).
  const isCollegeScoped = roleParamScope === "COLLEGE" || (!roleParam && !!collegeId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>(roleParam || "PRINCIPAL");
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});

  useEffect(() => {
    if (isCollegeScoped) {
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
          setPhotoUrl((u.profilePhotoUrl as string) || undefined);
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
    } else if (roleParamScope === "LOCATION") {
      // Administration or Accounts — profile lives at locations/{id}/locationUsers.
      if (!locationId) {
        toast({ variant: "destructive", title: "Missing location context" });
        router.push("/super-admin/users");
        return;
      }
      fetch(`/api/location/users?locationId=${locationId}`)
        .then((r) => r.json() as Promise<{ users?: Record<string, unknown>[] }>)
        .then((data) => {
          const u = (data.users ?? []).find((x) => x.uid === uid);
          if (!u) {
            toast({ variant: "destructive", title: "User not found" });
            router.push("/super-admin/users");
            return;
          }
          setEmail((u.email as string) ?? "");
          setName((u.name as string) ?? "");
          setRole(roleParam as UserRole);
          setPhotoUrl((u.profilePhotoUrl as string) || undefined);
          setAcademicProfile((u.academicProfile as Partial<FacultyProfileFields>) ?? {});
        })
        .catch(() => toast({ variant: "destructive", title: "Failed to load user" }))
        .finally(() => setLoading(false));
    } else if (roleParamScope === "GLOBAL") {
      // Management, Finance, or Purchase — profile lives only in systemUsers.
      fetch("/api/admin/users?scope=global")
        .then((r) => r.json() as Promise<{ users?: Record<string, unknown>[] }>)
        .then((data) => {
          const u = (data.users ?? []).find((x) => x.uid === uid);
          if (!u) {
            toast({ variant: "destructive", title: "User not found" });
            router.push("/super-admin/users");
            return;
          }
          setEmail((u.email as string) ?? "");
          setName((u.name as string) ?? "");
          setRole(roleParam as UserRole);
          setPhotoUrl((u.profilePhotoUrl as string) || undefined);
          setAcademicProfile((u.academicProfile as Partial<FacultyProfileFields>) ?? {});
        })
        .catch(() => toast({ variant: "destructive", title: "Failed to load user" }))
        .finally(() => setLoading(false));
    } else {
      toast({ variant: "destructive", title: "Unknown role context" });
      router.push("/super-admin/users");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, collegeId, locationId, roleParam, roleParamScope]);

  async function handlePhotoUploaded(url: string) {
    try {
      const res = await fetch(`/api/admin/users/${uid}/photo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoUrl: url,
          role,
          collegeId: collegeId || undefined,
          locationId: locationId || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      setPhotoUrl(url);
      toast({ variant: "success", title: "Photo updated" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save photo" });
    }
  }

  async function handlePhotoDeleted() {
    try {
      const res = await fetch(`/api/admin/users/${uid}/photo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoUrl: "",
          role,
          collegeId: collegeId || undefined,
          locationId: locationId || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      setPhotoUrl(undefined);
      toast({ variant: "success", title: "Photo removed" });
    } catch {
      toast({ variant: "destructive", title: "Failed to remove photo" });
    }
  }

  async function handleOtherInfoSaved() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${uid}/photo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otherInformation: academicProfile.otherInformation ?? "",
          role,
          collegeId: collegeId || undefined,
          locationId: locationId || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Saved" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

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
          academicProfile,
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

      {isCollegeScoped ? (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">User Details</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
                  <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                    <Label>Profile Photo</Label>
                    <AvatarUploadField name={name || "?"} photoUrl={photoUrl} targetId={uid} onUploaded={handlePhotoUploaded} onDeleted={() => void handlePhotoDeleted()} />
                  </div>
                  <div className="grid flex-1 grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <Label>Full Name *</Label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone / WhatsApp" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COLLEGE_SCOPE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                    </SelectContent>
                  </Select>
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

          {role === "PRINCIPAL" ? (
            <Card className="mt-6">
              <CardHeader><CardTitle className="text-base">Academic Profile</CardTitle></CardHeader>
              <CardContent>
                <AcademicProfileFields value={academicProfile} onChange={setAcademicProfile} includeTeachingAssignment={false} />
              </CardContent>
            </Card>
          ) : (
            <Card className="mt-6">
              <CardHeader><CardTitle className="text-base">Module 6 — Others</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label>Other Information</Label>
                  <Textarea
                    value={academicProfile.otherInformation ?? ""}
                    onChange={(e) => setAcademicProfile({ ...academicProfile, otherInformation: e.target.value })}
                    placeholder="Anything not covered above — add it here"
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">Saved together with &quot;Save Changes&quot; above.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <Label>Profile Photo</Label>
                  <AvatarUploadField name={name || "?"} photoUrl={photoUrl} targetId={uid} onUploaded={handlePhotoUploaded} onDeleted={() => void handlePhotoDeleted()} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {ROLE_LABELS[role]} accounts only support editing the profile photo and Module 6 — Others from Super Admin. Name: <strong className="text-foreground">{name}</strong>
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="mt-6">
            <CardHeader><CardTitle className="text-base">Module 6 — Others</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Textarea
                  value={academicProfile.otherInformation ?? ""}
                  onChange={(e) => setAcademicProfile({ ...academicProfile, otherInformation: e.target.value })}
                  placeholder="Anything not covered above — add it here"
                  rows={4}
                />
                <div className="flex justify-end">
                  <Button type="button" loading={saving} onClick={() => void handleOtherInfoSaved()}>Save</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
