"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { AcademicProfileFields } from "@/components/faculty/AcademicProfileFields";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_LABELS, ROLE_LEVEL, ROLE_SCOPE, LEVEL_LABELS } from "@/types";
import { PHONE_REGEX } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import type { College, Location, FacultyProfileFields, UserRole } from "@/types";

// Roles a Super Admin creates - the level L1–L2 set plus DIRECTOR (L3) and
// PANEL_MEMBER/Faculty (L5, a plain login - not the full HOD-side hiring/
// onboarding wizard). Scope (GLOBAL/LOCATION/COLLEGE) is read from ROLE_SCOPE,
// which drives which tenant picker is shown and what the provisioning route
// (api/admin/users) writes. Principal is deliberately not here any more: it's
// a SEAT, appointed by a college's own College Admin via Role Assignments, not
// handed out directly - same reasoning as removing it from Location Admin.
// Must match SUPER_ADMIN_CREATABLE in api/admin/users/route.ts.
const CREATABLE_ROLES: UserRole[] = [
  "MANAGEMENT", "FINANCE", "PURCHASE_DEPT",   // L1 · GLOBAL
  "ADMINISTRATION", "ACCOUNTS",               // L2 · LOCATION
  "DIRECTOR",                                 // L3 · COLLEGE
  "PANEL_MEMBER",                             // L5 · COLLEGE (Faculty)
];

// Creatable roles grouped by their L0–L6 level, so the role picker is level-scoped.
const ROLE_LEVELS_PRESENT = Array.from(
  new Set(CREATABLE_ROLES.map((r) => ROLE_LEVEL[r]))
).sort((a, b) => a - b);

export default function NewUserPage() {
  const router = useRouter();
  const [colleges, setColleges] = useState<College[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [collegeEmail, setCollegeEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("12345678");
  const [role, setRole] = useState<UserRole>("MANAGEMENT");
  const [collegeId, setCollegeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [tempPhotoId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const collegeType = colleges.find((c) => c.id === collegeId)?.type;

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

  const scope = ROLE_SCOPE[role]; // GLOBAL | LOCATION | COLLEGE
  // College picker cascades off the chosen location (multiple colleges per location).
  const collegesForLocation = colleges.filter((c) => c.locationId === locationId);

  // Employee ID is mandatory when manually adding a college-scoped person -
  // there's no import/bulk flow behind this form to backfill it later.
  const employeeIdRequired = role === "DIRECTOR" || role === "PANEL_MEMBER";
  // Phone stays optional (not every seat needs one on file), but a filled-in
  // value has to actually be a usable 10-digit Indian mobile number - same
  // PHONE_REGEX every other phone field in the app (faculty import, Add
  // Faculty, ...) is held to, rather than accepting any text.
  const phoneError = phone.trim() && !PHONE_REGEX.test(phone.trim())
    ? "Enter a valid 10-digit mobile number (starts with 6-9)"
    : "";
  const isValid = !!name && !!email && !!password && !!role &&
    (scope === "GLOBAL" ? true : scope === "LOCATION" ? !!locationId : !!locationId && !!collegeId) &&
    (!employeeIdRequired || !!employeeId.trim()) && !phoneError;

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
          academicProfile,
          ...(role === "DIRECTOR" ? { ...personalDetails, collegeEmail, employeeId } : {}),
          ...(role === "PANEL_MEMBER" ? { employeeId, department } : {}),
          ...(photoUrl ? { profilePhotoUrl: photoUrl } : {}),
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
    <div className="w-full">
      <PageHeader title="Add User" description="Create a staff account by level and assign scope" />
      <Card>
        <CardHeader><CardTitle className="text-base">User Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                <Label>Profile Photo</Label>
                <AvatarUploadField name={name || "?"} photoUrl={photoUrl} targetId={tempPhotoId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl(undefined)} />
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Full Name <span className="text-destructive">*</span></Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
                </div>
                <div className="space-y-2">
                  <Label>Personal Email <span className="text-destructive">*</span></Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
                </div>
                {role === "DIRECTOR" && (
                  <>
                    <div className="space-y-2">
                      <Label>College Email</Label>
                      <Input type="email" value={collegeEmail} onChange={(e) => setCollegeEmail(e.target.value)} placeholder="name@example.com" />
                    </div>
                    <div className="space-y-2">
                      <Label>Employee ID <span className="text-destructive">*</span></Label>
                      <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-001" />
                    </div>
                  </>
                )}
                {role === "PANEL_MEMBER" && (
                  <>
                    <div className="space-y-2">
                      <Label>Employee ID <span className="text-destructive">*</span></Label>
                      <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-001" />
                    </div>
                    <div className="space-y-2">
                      <Label>Department</Label>
                      <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. CSE" />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Temporary Password <span className="text-destructive">*</span></Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {/* Role - grouped by level (L1–L3) */}
            <div className="space-y-2">
              <Label>Role <span className="text-destructive">*</span></Label>
              <Select value={role} onValueChange={(v) => { setRole(v as UserRole); setCollegeId(""); setLocationId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_LEVELS_PRESENT.map((lvl) => (
                    <SelectGroup key={lvl}>
                      <SelectLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                        {LEVEL_LABELS[lvl]}
                      </SelectLabel>
                      {CREATABLE_ROLES.filter((r) => ROLE_LEVEL[r] === lvl).map((r) => (
                        <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {scope === "GLOBAL"
                  ? "Global role - not tied to any location or college."
                  : scope === "LOCATION"
                    ? "Location-scoped role - choose a location."
                    : "College-scoped role - choose a location, then a college."}
              </p>
            </div>

            {/* Scope pickers - driven by ROLE_SCOPE[role] */}
            {scope === "GLOBAL" ? (
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  type="tel"
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit mobile number"
                />
                {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Location <span className="text-destructive">*</span></Label>
                  <Select value={locationId} onValueChange={(v) => { setLocationId(v); setCollegeId(""); }}>
                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {scope === "COLLEGE" && (
                  <div className="space-y-2">
                    <Label>College <span className="text-destructive">*</span></Label>
                    <Select value={collegeId} onValueChange={setCollegeId} disabled={!locationId}>
                      <SelectTrigger>
                        <SelectValue placeholder={locationId ? "Select college" : "Select a location first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {collegesForLocation.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            No colleges in this location
                          </div>
                        ) : (
                          collegesForLocation.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            {scope !== "GLOBAL" && (
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  type="tel"
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit mobile number"
                />
                {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!isValid}>Create User</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {role === "DIRECTOR" ? (
        // Collapsed by default (no defaultValue) - Personal Details and
        // Academic Profile are both long forms, and having both permanently
        // expanded stacked below the main form was most of what made this
        // page so scrolly. Each section's fields now only appear once its
        // own header is clicked; "multiple" (not "single") still lets both
        // be open at once if the person wants that.
        <Accordion type="multiple" className="mt-6 space-y-3">
          <AccordionItem value="personal" className="border rounded-lg bg-card px-4">
            <AccordionTrigger className="text-base font-semibold hover:no-underline">Personal Details</AccordionTrigger>
            <AccordionContent>
              <PersonalDetailsFields value={personalDetails} onChange={setPersonalDetails} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="academic" className="border rounded-lg bg-card px-4">
            <AccordionTrigger className="text-base font-semibold hover:no-underline">Academic Profile</AccordionTrigger>
            <AccordionContent>
              <AcademicProfileFields value={academicProfile} onChange={setAcademicProfile} includeTeachingAssignment={false} collegeType={collegeType} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : role === "PANEL_MEMBER" ? (
        // Kept deliberately minimal - a quick login for an existing/incoming
        // faculty member. Their full profile (qualifications, experience, ...)
        // is filled in later from their own faculty record, not at creation.
        null
      ) : (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Module 6 - Others</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Other Information</Label>
              <Textarea
                value={academicProfile.otherInformation ?? ""}
                onChange={(e) => setAcademicProfile({ ...academicProfile, otherInformation: e.target.value })}
                placeholder="Anything not covered above - add it here"
                rows={4}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
