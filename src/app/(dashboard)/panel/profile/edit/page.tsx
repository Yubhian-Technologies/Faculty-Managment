"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { HIGHEST_QUALIFICATION_OPTIONS } from "@/lib/import/fieldConstraints";
import { PHONE_REGEX } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { DESIGNATION_LABELS, EMPLOYEE_CATEGORY_LABELS } from "@/types";
import type { FacultyMember } from "@/types";

// Sentinel for the "Others" row - matches hod/faculty/new/page.tsx's own
// qualification picker.
const OTHER_QUALIFICATION = "__OTHER__";

interface IdentityForm {
  legalName: string;
  name: string;
  apaarFacultyId: string;
  qualification: string;
  specialization: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: IdentityForm = {
  legalName: "", name: "", apaarFacultyId: "", qualification: "", specialization: "", email: "", phone: "",
};

// Self-service Identity & Employment editor for the "My Profile" page - the
// counterpart to hod/faculty/[id]/edit/page.tsx, but for a Faculty member
// editing their own record via PATCH /api/college/faculty/me. Everything
// HR/HOD-controlled (Employee ID, College Email, Department, Designation,
// Employee Category, Date of Joining, AICTE Faculty ID) is shown read-only
// for context, never sent in the update - matching what
// that PATCH route itself accepts (see its own doc-comment).
export default function EditMyProfileIdentityPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [collegeEmail, setCollegeEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [designationLabel, setDesignationLabel] = useState("");
  const [employeeCategoryLabel, setEmployeeCategoryLabel] = useState("");
  const [joiningDateLabel, setJoiningDateLabel] = useState("");
  const [aicteFacultyId, setAicteFacultyId] = useState("");
  const [form, setForm] = useState<IdentityForm>(EMPTY_FORM);
  const [qualIsOther, setQualIsOther] = useState(false);
  const [extraPhones, setExtraPhones] = useState<{ label?: string; number: string }[]>([]);

  useEffect(() => {
    fetch("/api/college/faculty/me")
      .then((r) => r.json() as Promise<{ faculty: Partial<FacultyMember> | null }>)
      .then((d) => {
        const m = d.faculty;
        if (!m) {
          toast({ variant: "destructive", title: "Profile record not found" });
          router.push("/panel/profile");
          return;
        }
        setEmployeeId(m.employeeId ?? "");
        setCollegeEmail(m.collegeEmail ?? "");
        setDepartment(m.department ?? "");
        setDesignationLabel(m.designation ? (DESIGNATION_LABELS[m.designation] ?? m.designation) : "-");
        setEmployeeCategoryLabel(m.employeeCategory ? (EMPLOYEE_CATEGORY_LABELS[m.employeeCategory] ?? m.employeeCategory) : "-");
        setJoiningDateLabel(m.joiningDate ? formatDate(m.joiningDate) : "-");
        setAicteFacultyId(m.aicteFacultyId ?? "-");
        const qualification = m.qualification ?? "";
        setQualIsOther(!!qualification && !(HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(qualification));
        setForm({
          legalName: m.legalName ?? "",
          name: m.name ?? "",
          apaarFacultyId: m.apaarFacultyId ?? "",
          qualification,
          specialization: m.specialization ?? "",
          email: m.email ?? "",
          phone: m.phone ?? "",
        });
        setExtraPhones(m.additionalPhoneNumbers ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load profile" }))
      .finally(() => setLoading(false));
  }, [router]);

  function set(patch: Partial<IdentityForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.legalName.trim()) {
      toast({ variant: "destructive", title: "Full Name (as per SSC) is required" });
      return;
    }
    if (!form.qualification.trim()) {
      toast({ variant: "destructive", title: "Highest Qualification is required" });
      return;
    }
    if (!form.phone.trim() || !PHONE_REGEX.test(form.phone)) {
      toast({ variant: "destructive", title: "Mobile No is required and must be a valid phone number" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/college/faculty/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName: form.legalName.trim().toUpperCase(),
          name: form.name.trim(),
          apaarFacultyId: form.apaarFacultyId.trim(),
          qualification: form.qualification.trim(),
          specialization: form.specialization.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          additionalPhoneNumbers: extraPhones.filter((p) => p.number.trim()),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save changes");
      }
      toast({ variant: "success", title: "Profile updated" });
      router.push("/panel/profile");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save changes" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <PageHeader title="Edit Identity & Employment" description="Loading…" />;
  }

  return (
    <div className="max-w-2xl">
      <Button variant="ghost" size="sm" className="mb-4" asChild>
        <Link href="/panel/profile">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to My Profile
        </Link>
      </Button>
      <PageHeader title="Edit Identity & Employment" description={`Employee ID: ${employeeId}`} />

      <form onSubmit={(e) => void handleSubmit(e)}>
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Identity & Employment</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <p className="text-xs text-muted-foreground -mt-2">
              Employee ID, College Email, Department, Designation, Employee Category, Date of Joining and AICTE Faculty ID are set by your HOD/Principal and can&apos;t be changed here.
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={employeeId} disabled />
              </div>
              <div className="space-y-2">
                <Label>College Email</Label>
                <Input value={collegeEmail} disabled />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Full Name (as per SSC) *</Label>
              <Input
                value={form.legalName}
                onChange={(e) => set({ legalName: e.target.value.toUpperCase() })}
                placeholder="FULL NAME IN CAPITALS"
                className="uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label>Name (as per PAN)</Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Dr. Priya Nair" />
            </div>
            <div className="space-y-2">
              <Label>APAAR Faculty ID</Label>
              <Input value={form.apaarFacultyId} onChange={(e) => set({ apaarFacultyId: e.target.value })} placeholder="NBA/AICTE APAAR ID" />
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Role Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={department || "-"} disabled />
              </div>
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={designationLabel} disabled />
              </div>
              <div className="space-y-2">
                <Label>Employee Category</Label>
                <Input value={employeeCategoryLabel} disabled />
              </div>
              <div className="space-y-2">
                <Label>Highest Qualification *</Label>
                <Select
                  value={qualIsOther ? OTHER_QUALIFICATION : (HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(form.qualification) ? form.qualification : ""}
                  onValueChange={(v) => {
                    const other = v === OTHER_QUALIFICATION;
                    setQualIsOther(other);
                    set({ qualification: other ? "" : v });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger>
                  <SelectContent>
                    {HIGHEST_QUALIFICATION_OPTIONS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                    <SelectItem value={OTHER_QUALIFICATION}>Others</SelectItem>
                  </SelectContent>
                </Select>
                {qualIsOther && (
                  <Input value={form.qualification} onChange={(e) => set({ qualification: e.target.value })} placeholder="e.g. MBA, M.Phil, M.A" />
                )}
              </div>
              <div className="space-y-2">
                <Label>Specialization</Label>
                <Input value={form.specialization} onChange={(e) => set({ specialization: e.target.value })} placeholder="e.g. Machine Learning, VLSI" />
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date of Joining Institution</Label>
                <Input value={joiningDateLabel} disabled />
              </div>
              <div className="space-y-2">
                <Label>AICTE Faculty ID</Label>
                <Input value={aicteFacultyId} disabled />
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Contact Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Personal Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="faculty@example.com" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Mobile No *</Label>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setExtraPhones((p) => [...p, { label: "", number: "" }])}
                  >
                    + Add Number
                  </Button>
                </div>
                <Input type="tel" autoComplete="off" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 98765 43210" />
              </div>
            </div>

            {extraPhones.length > 0 && (
              <div className="space-y-3">
                {extraPhones.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <TextInput
                        label="Label (optional)"
                        value={item.label}
                        onChange={(v) => setExtraPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, label: v } : p)))}
                        placeholder="e.g. Personal, WhatsApp, or a name"
                      />
                      <TextInput
                        label="Mobile Number"
                        value={item.number}
                        onChange={(v) => setExtraPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, number: v } : p)))}
                        placeholder="+91 98765 43210"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-7"
                      onClick={() => setExtraPhones((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end mt-6 pt-4 border-t">
          <Button type="button" variant="outline" onClick={() => router.push("/panel/profile")}>Cancel</Button>
          <Button type="submit" loading={saving}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
