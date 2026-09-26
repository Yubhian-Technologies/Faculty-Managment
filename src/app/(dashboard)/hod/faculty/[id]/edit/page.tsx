"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { HIGHEST_QUALIFICATION_OPTIONS } from "@/lib/import/fieldConstraints";
import { normalizeHighestQualification } from "@/lib/faculty/highestQualification";
import { PHONE_REGEX, EMAIL_REGEX, APAAR_REGEX } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import { migrateFacultyDoc } from "@/lib/faculty/fieldRenames";
import { toDateInputValue } from "@/lib/utils";
import { designationLabel } from "@/lib/designations/config";
import { EMPLOYEE_CATEGORY_LABELS, FACULTY_STATUS_LABELS, MANUALLY_SELECTABLE_FACULTY_STATUS_VALUES, FACULTY_STATUS_DATE_FIELD, FACULTY_STATUS_DATE_LABELS } from "@/types";
import type { DesignationCatalogItem, Designation, EmployeeCategory, FacultyStatus } from "@/types";

// Sentinel for the "Others" row - matches hod/faculty/new/page.tsx's own
// highest-qualification picker.
const OTHER_QUALIFICATION = "__OTHER__";

interface IdentityForm {
  legalName: string;
  apaarFacultyId: string;
  designation: Designation | "";
  employeeCategory: EmployeeCategory | "";
  status: FacultyStatus;
  resignedDate: string;
  retiredDate: string;
  retainershipDate: string;
  highestQualification: string;
  specialization: string;
  joiningDate: string;
  aicteFacultyId: string;
  email: string;
  mobileNo: string;
}

const EMPTY_FORM: IdentityForm = {
  legalName: "", apaarFacultyId: "", designation: "", employeeCategory: "", status: "ACTIVE",
  resignedDate: "", retiredDate: "", retainershipDate: "",
  highestQualification: "", specialization: "", joiningDate: "", aicteFacultyId: "",
  email: "", mobileNo: "",
};

// Identity & Employment editor for an EXISTING faculty member - the Add
// Faculty wizard's "core" step has no edit-time equivalent anywhere else, so
// Designation/Employee Category/Date of Joining/AICTE details etc. were only
// ever settable at creation. Employee ID, College Email (login username) and
// the login password are deliberately locked here - changing an Employee ID
// or College Email has cross-college uniqueness/login implications handled
// by dedicated flows elsewhere (not this form), and the password is set via
// the faculty list's own "Set Login" action.
export default function EditHodFacultyIdentityPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const facultyId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [collegeEmail, setCollegeEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [form, setForm] = useState<IdentityForm>(EMPTY_FORM);
  const [qualIsOther, setQualIsOther] = useState(false);
  const [extraPhones, setExtraPhones] = useState<{ label?: string; number: string }[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  // With a Promotion History on file, that history (College Office > Promotion & Salary) decides the
  // current designation - the server rejects a different value here, so the field is read-only.
  const [designationManaged, setDesignationManaged] = useState(false);
  const [designationOptions, setDesignationOptions] = useState<string[]>([]);

  useEffect(() => {
    fetch(`/api/college/faculty/${facultyId}`)
      .then((r) => r.json() as Promise<{ faculty?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.faculty) {
          toast({ variant: "destructive", title: "Faculty record not found" });
          router.push("/hod/faculty");
          return;
        }
        const m = migrateFacultyDoc(data.faculty);
        setEmployeeId((m.employeeId as string) ?? "");
        setCollegeEmail((m.collegeEmail as string) ?? "");
        setDepartment((m.department as string) ?? "");
        const highestQualification = normalizeHighestQualification(m.highestQualification);
        setQualIsOther(!!highestQualification && !(HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(highestQualification));
        setForm({
          legalName: (m.legalName as string) ?? "",
          apaarFacultyId: (m.apaarFacultyId as string) ?? "",
          designation: (m.designation as Designation) ?? "",
          employeeCategory: (m.employeeCategory as EmployeeCategory) ?? "",
          status: (m.status as FacultyStatus) ?? "ACTIVE",
          resignedDate: toDateInputValue(m.resignedDate as never),
          retiredDate: toDateInputValue(m.retiredDate as never),
          retainershipDate: toDateInputValue(m.retainershipDate as never),
          highestQualification,
          specialization: (m.specialization as string) ?? "",
          joiningDate: toDateInputValue(m.joiningDate as never),
          aicteFacultyId: (m.aicteFacultyId as string) ?? "",
          email: (m.email as string) ?? "",
          mobileNo: (m.mobileNo as string) ?? "",
        });
        const history = (m.academicProfile as { promotionHistory?: unknown[] } | undefined)?.promotionHistory;
        setDesignationManaged(Array.isArray(history) && history.length > 0);
        setExtraPhones((m.additionalPhoneNumbers as { label?: string; number: string }[]) ?? []);
        setPhotoUrl((m.profilePhotoUrl as string) || undefined);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty record" }))
      .finally(() => setLoading(false));
  }, [facultyId, router]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/designations?category=FACULTY");
        const data = await res.json() as { items?: DesignationCatalogItem[] };
        setDesignationOptions((data.items ?? []).filter((d) => d.isActive).map((d) => d.name));
      } catch {
        // Non-fatal - the picker just stays empty until the catalog loads.
      }
    })();
  }, []);

  function set(patch: Partial<IdentityForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.legalName.trim()) {
      toast({ variant: "destructive", title: "Full Name (as per SSC) is required" });
      return;
    }
    if (!form.designation) {
      toast({ variant: "destructive", title: "Designation is required" });
      return;
    }
    if (!form.employeeCategory) {
      toast({ variant: "destructive", title: "Employee Category is required" });
      return;
    }
    const statusDateField = FACULTY_STATUS_DATE_FIELD[form.status];
    if (statusDateField && !form[statusDateField].trim()) {
      toast({ variant: "destructive", title: `${FACULTY_STATUS_DATE_LABELS[statusDateField]} is required` });
      return;
    }
    if (!form.highestQualification.trim()) {
      toast({ variant: "destructive", title: "Highest Qualification is required" });
      return;
    }
    if (!form.joiningDate) {
      toast({ variant: "destructive", title: "Date of Joining is required" });
      return;
    }
    if (!form.mobileNo.trim() || !PHONE_REGEX.test(form.mobileNo)) {
      toast({ variant: "destructive", title: "Mobile No must be exactly 10 digits, starting with 6, 7, 8 or 9" });
      return;
    }
    if (form.email.trim() && !EMAIL_REGEX.test(form.email.trim())) {
      toast({ variant: "destructive", title: "Enter a valid email address" });
      return;
    }
    if (form.apaarFacultyId.trim() && !APAAR_REGEX.test(form.apaarFacultyId.trim())) {
      toast({ variant: "destructive", title: "APAAR Faculty ID must be exactly 12 digits" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/college/faculty/${facultyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName: form.legalName.trim().toUpperCase(),
          apaarFacultyId: form.apaarFacultyId.trim(),
          designation: form.designation,
          employeeCategory: form.employeeCategory,
          status: form.status,
          ...(form.resignedDate ? { resignedDate: form.resignedDate } : {}),
          ...(form.retiredDate ? { retiredDate: form.retiredDate } : {}),
          ...(form.retainershipDate ? { retainershipDate: form.retainershipDate } : {}),
          highestQualification: form.highestQualification.trim(),
          specialization: form.specialization.trim(),
          joiningDate: form.joiningDate,
          aicteFacultyId: form.aicteFacultyId.trim(),
          email: form.email.trim(),
          mobileNo: form.mobileNo.trim(),
          additionalPhoneNumbers: extraPhones.filter((p) => p.number.trim()),
          ...(photoUrl !== undefined ? { profilePhotoUrl: photoUrl } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save changes");
      }
      toast({ variant: "success", title: "Faculty details updated" });
      router.push(`/hod/faculty/${facultyId}`);
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
        <Link href={`/hod/faculty/${facultyId}`}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Faculty Details
        </Link>
      </Button>
      <PageHeader title="Edit Identity & Employment" description={`Employee ID: ${employeeId}`} />

      <form onSubmit={(e) => void handleSubmit(e)}>
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Identity & Employment</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <p className="text-xs text-muted-foreground -mt-2">
              Employee ID, College Email and the login password can&apos;t be changed here.
            </p>

            <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                <Label>Profile Photo</Label>
                <AvatarUploadField name={form.legalName || "?"} photoUrl={photoUrl} targetId={facultyId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl("")} />
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Employee ID</Label>
                  <Input value={employeeId} disabled />
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
                  <Label>APAAR Faculty ID</Label>
                  <Input
                    inputMode="numeric" maxLength={12}
                    value={form.apaarFacultyId}
                    onChange={(e) => set({ apaarFacultyId: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                    placeholder="123456789012"
                  />
                  {!!form.apaarFacultyId && !APAAR_REGEX.test(form.apaarFacultyId) && (
                    <p className="text-xs text-destructive">Must be exactly 12 digits</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>College Email</Label>
                <Input value={collegeEmail} disabled />
                <p className="text-xs text-muted-foreground">This is their login username.</p>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={department || "-"} disabled />
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Role Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Select value={form.designation} onValueChange={(v) => set({ designation: v as Designation })} disabled={designationManaged}>
                  <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                  <SelectContent>
                    {designationOptions.map((d) => <SelectItem key={d} value={d}>{designationLabel(d)}</SelectItem>)}
                    {/* A saved designation that's no longer an active catalog entry (deactivated,
                        removed, or the catalog not loaded yet) must still show as selected rather
                        than a blank picker - the record keeps its value either way. */}
                    {form.designation && !designationOptions.includes(form.designation) && (
                      <SelectItem value={form.designation}>{designationLabel(form.designation)}{designationOptions.length > 0 ? " (not in active list)" : ""}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {designationManaged && (
                  <p className="text-xs text-muted-foreground">
                    Managed by this faculty member&apos;s Promotion History - College Office updates it under Promotion &amp; Salary.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Employee Category *</Label>
                <Select value={form.employeeCategory} onValueChange={(v) => set({ employeeCategory: v as EmployeeCategory })}>
                  <SelectTrigger><SelectValue placeholder="Select employee category" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYEE_CATEGORY_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status *</Label>
                <Select value={form.status} onValueChange={(v) => set({ status: v as FacultyStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MANUALLY_SELECTABLE_FACULTY_STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>{FACULTY_STATUS_LABELS[s]}</SelectItem>
                    ))}
                    {/* On Leave can no longer be picked manually (see its own
                        status option, set only by the Leave module) - but an
                        already on-leave record must still show and keep its
                        real value here rather than going blank. */}
                    {form.status === "ON_LEAVE" && (
                      <SelectItem value="ON_LEAVE">{FACULTY_STATUS_LABELS.ON_LEAVE}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {/* Only Resigned/Retired/Retainership carry a date - see
                  FACULTY_STATUS_DATE_FIELD's own doc-comment in types/core.ts. */}
              {FACULTY_STATUS_DATE_FIELD[form.status] && (
                <div className="space-y-2">
                  <Label>{FACULTY_STATUS_DATE_LABELS[FACULTY_STATUS_DATE_FIELD[form.status]!]} *</Label>
                  <Input
                    type="date"
                    value={form[FACULTY_STATUS_DATE_FIELD[form.status]!]}
                    onChange={(e) => set({ [FACULTY_STATUS_DATE_FIELD[form.status]!]: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Highest Qualification *</Label>
                <Select
                  value={qualIsOther ? OTHER_QUALIFICATION : (HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(form.highestQualification) ? form.highestQualification : ""}
                  onValueChange={(v) => {
                    const other = v === OTHER_QUALIFICATION;
                    setQualIsOther(other);
                    set({ highestQualification: other ? "" : v });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger>
                  <SelectContent>
                    {HIGHEST_QUALIFICATION_OPTIONS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                    <SelectItem value={OTHER_QUALIFICATION}>Others</SelectItem>
                  </SelectContent>
                </Select>
                {qualIsOther && (
                  <Input value={form.highestQualification} onChange={(e) => set({ highestQualification: e.target.value })} placeholder="e.g. B.Ed, MCA" />
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
                <Label>Date of Joining *</Label>
                <Input type="date" value={form.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>AICTE Faculty ID</Label>
                <Input value={form.aicteFacultyId} onChange={(e) => set({ aicteFacultyId: e.target.value })} placeholder="AICTE Faculty ID" />
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Contact Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Personal Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="faculty@example.com" />
                {!!form.email.trim() && !EMAIL_REGEX.test(form.email.trim()) && (
                  <p className="text-xs text-destructive">Doesn&rsquo;t look like a valid email address</p>
                )}
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
                <Input
                  type="tel" inputMode="numeric" autoComplete="off" maxLength={10}
                  value={form.mobileNo}
                  onChange={(e) => set({ mobileNo: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                  placeholder="9876543210"
                />
                {!!form.mobileNo && !PHONE_REGEX.test(form.mobileNo) && (
                  <p className="text-xs text-destructive">Must be exactly 10 digits, starting with 6, 7, 8 or 9</p>
                )}
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
                        type="tel"
                        value={item.number}
                        onChange={(v) => setExtraPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, number: v } : p)))}
                        placeholder="9876543210"
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
          <Button type="button" variant="outline" onClick={() => router.push(`/hod/faculty/${facultyId}`)}>Cancel</Button>
          <Button type="submit" loading={saving}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
