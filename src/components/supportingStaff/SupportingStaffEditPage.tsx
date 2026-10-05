"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2, User, UserPen } from "lucide-react";
import { WizardPage, WizardHero, WizardStepper, WizardStepHeader, type ChromeStep } from "@/components/shared/WizardChrome";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { getMissingRequiredPersonalFields, SUPPORTING_STAFF_REQUIRED_PERSONAL_FIELDS } from "@/components/shared/PersonalDetailsFields";
import { SupportingStaffModuleEditor, type SupportingStaffEditRecord } from "@/components/supportingStaff/SupportingStaffModuleEditor";
import { getSupportingStaffProfileModules, type SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import { supportingStaffIdentityPatchBody, supportingStaffModulePatchBody, supportingStaffRecordFromDoc } from "@/lib/supportingStaff/moduleRecord";
import { useActiveDepartments } from "@/hooks/useActiveDepartments";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";
import { APAAR_REGEX } from "@/lib/validations";
import { FACULTY_STATUS_LABELS } from "@/types";
import type { FacultyStatus, SupportingStaffDesignation } from "@/types";

// The Edit page for Supporting Staff (Technical - HOD; Non-Technical - College Office / Library / Principal). It reads
// and behaves exactly like the Add wizard: same hero, the same step bar, the same step header and card. The first tab
// (Identity & Employment) is the account/employment form these pages always had, with the same fields, checks and
// save. Every other tab is the matching profile section (Personal Details, Qualifications, ...) edited right here
// with the very same editor and the very same save the per-section page ([id]/[module]/edit) uses - and that page
// still works for anyone who lands on it directly. Each tab saves on its own; switching tabs never loses what was typed.

interface StaffForm {
  apaarFacultyId: string;
  mobileNo: string;
  collegeEmail: string;
  designation: SupportingStaffDesignation;
  otherDesignationTitle: string;
  department: string;
  highestQualification: string;
  status: FacultyStatus;
  joiningDate: string;
}

const EMPTY_FORM: StaffForm = {
  apaarFacultyId: "", mobileNo: "", collegeEmail: "", designation: "", otherDesignationTitle: "",
  department: "", highestQualification: "", status: "ACTIVE", joiningDate: "",
};

type EditTabKey = "core" | SupportingStaffModuleKey;

export interface SupportingStaffEditPageProps {
  staffId: string;
  /** "Edit Supporting Staff" / "Edit Non-Technical Staff". */
  title: string;
  /** Where to go when the record can't be loaded. */
  loadFailPath: string;
  backHref: string;
  backLabel: string;
  /** Where Cancel and a successful Identity save go. */
  afterSavePath: string;
  /** The <SelectItem>s of the Designation picker (the catalog differs between Technical and Non-Technical). */
  designationContent: ReactNode;
  /**
   * "locked"  - the department is shown but can't change, and is never sent (HOD: a Technical record stays in its department)
   * "library" - fixed to Library
   * "select"  - any active department, or none
   */
  departmentMode: "locked" | "library" | "select";
  otherDesignationPlaceholder: string;
}

function DepartmentSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const departments = useActiveDepartments();
  return (
    <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger><SelectValue placeholder="Centrally managed" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Centrally managed (no department)</SelectItem>
        {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function SupportingStaffEditPage({
  staffId, title, loadFailPath, backHref, backLabel, afterSavePath, designationContent, departmentMode, otherDesignationPlaceholder,
}: SupportingStaffEditPageProps) {
  const router = useRouter();
  const { collegeType } = useCollegeType();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingModule, setSavingModule] = useState<SupportingStaffModuleKey | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  // Holds Full Name (as per SSC) too - it is edited on Identity & Employment but saved by BOTH that tab and Personal
  // Details, so there must be exactly one copy of it (same arrangement as the Add wizard).
  const [record, setRecord] = useState<SupportingStaffEditRecord>({});
  const [extraPhones, setExtraPhones] = useState<{ label?: string; number: string }[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<EditTabKey>("core");

  const tabs: (ChromeStep & { key: EditTabKey })[] = useMemo(() => [
    { key: "core", label: "Identity & Employment", icon: User, description: "Official ID, login email, designation and employment details" },
    ...getSupportingStaffProfileModules().map((m) => ({ key: m.key as EditTabKey, label: m.label, icon: m.icon })),
  ], []);

  useEffect(() => {
    fetch(`/api/college/supporting-staff/${staffId}`)
      .then((r) => r.json() as Promise<{ staff?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.staff) {
          toast({ variant: "destructive", title: "Staff record not found" });
          router.push(loadFailPath);
          return;
        }
        const m = data.staff;
        setEmployeeId((m.employeeId as string) ?? "");
        setEmail((m.email as string) ?? "");
        setForm({
          apaarFacultyId: (m.apaarFacultyId as string) ?? "",
          mobileNo: (m.mobileNo as string) ?? "",
          collegeEmail: (m.collegeEmail as string) ?? "",
          designation: (m.designation as SupportingStaffDesignation) ?? "",
          otherDesignationTitle: (m.otherDesignationTitle as string) ?? "",
          department: (m.department as string) ?? "",
          highestQualification: (m.highestQualification as string) ?? "",
          status: (m.status as FacultyStatus) ?? "ACTIVE",
          joiningDate: toDateInputValue(m.joiningDate as never),
        });
        setRecord(supportingStaffRecordFromDoc(m));
        setExtraPhones((m.additionalPhoneNumbers as { label?: string; number: string }[]) ?? []);
        setPhotoUrl((m.profilePhotoUrl as string) || undefined);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setLoading(false));
  }, [staffId, router, loadFailPath]);

  function set(patch: Partial<StaffForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const legalName = record.legalName ?? "";
    if (!employeeId.trim()) {
      toast({ variant: "destructive", title: "Employee ID is required" });
      return;
    }
    if (!form.collegeEmail.trim()) {
      toast({ variant: "destructive", title: "College email is required" });
      return;
    }
    if (!form.mobileNo.trim()) {
      toast({ variant: "destructive", title: "Mobile No is required" });
      return;
    }
    if (!form.highestQualification.trim()) {
      toast({ variant: "destructive", title: "Highest Qualification is required" });
      return;
    }
    if (!legalName.trim()) {
      toast({ variant: "destructive", title: "Full Name (as per SSC) is required" });
      return;
    }
    if (form.apaarFacultyId.trim() && !APAAR_REGEX.test(form.apaarFacultyId.trim())) {
      toast({ variant: "destructive", title: "APAAR Faculty ID must be exactly 12 digits" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/college/supporting-staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supportingStaffIdentityPatchBody({ form, legalName, email, employeeId, extraPhones, photoUrl, departmentMode })),
      });
      if (res.status === 409) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Employee ID already exists" });
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error();

      toast({ variant: "success", title: "Staff record updated" });
      router.push(afterSavePath);
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setSaving(false);
    }
  }

  // Same validation and same body as SupportingStaffModuleEditPage.handleSave; stays on the page afterwards so
  // nothing typed on another tab is lost.
  async function handleSaveModule(moduleKey: SupportingStaffModuleKey) {
    if (moduleKey === "personal") {
      const missing = getMissingRequiredPersonalFields(record, SUPPORTING_STAFF_REQUIRED_PERSONAL_FIELDS);
      if (missing.length > 0) {
        toast({ variant: "destructive", title: "Some required fields are missing", description: missing.join(", ") });
        return;
      }
    }
    setSavingModule(moduleKey);
    try {
      const res = await fetch(`/api/college/supporting-staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supportingStaffModulePatchBody(moduleKey, record)),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Saved" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setSavingModule(null);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title={title} description="Loading…" />
      </div>
    );
  }

  const activeStep = tabs.find((t) => t.key === activeTab) ?? tabs[0];

  return (
    <WizardPage>
      <Button variant="ghost" size="sm" className="-mb-2 self-start" asChild>
        <Link href={backHref}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {backLabel}
        </Link>
      </Button>
      <WizardHero icon={UserPen} title={title} description={`Employee ID: ${employeeId} · ${email}`} />

      {/* Same step bar as the Add wizard - click any tab to switch sections without leaving this page. */}
      <WizardStepper steps={tabs} currentKey={activeTab} onSelect={(i) => setActiveTab(tabs[i].key)} />

      {activeTab === "core" ? (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <Card className="shadow-xs border-border/80 overflow-hidden">
            <WizardStepHeader step={activeStep} />
            <CardContent className="p-5 sm:p-6 space-y-5">
              <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
                <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                  <Label>Profile Photo</Label>
                  <AvatarUploadField name={record.legalName || "?"} photoUrl={photoUrl} targetId={staffId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl("")} />
                </div>
                <div className="grid flex-1 grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="employeeId">Employee ID *</Label>
                    <Input id="employeeId" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-001" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="legalName">Full Name (as per SSC) *</Label>
                    <Input
                      id="legalName"
                      value={record.legalName ?? ""}
                      onChange={(e) => setRecord((r) => ({ ...r, legalName: e.target.value.toUpperCase() }))}
                      placeholder="FULL NAME IN CAPITALS"
                      className="uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="apaarFacultyId">APAAR Faculty ID</Label>
                    <Input
                      id="apaarFacultyId"
                      inputMode="numeric" maxLength={12}
                      value={form.apaarFacultyId}
                      onChange={(e) => set({ apaarFacultyId: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                      placeholder="123456789012"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="collegeEmail">College Email *</Label>
                <Input id="collegeEmail" type="email" value={form.collegeEmail} onChange={(e) => set({ collegeEmail: e.target.value })} placeholder="name@example.com" />
                <p className="text-xs text-muted-foreground">This is their login username.</p>
              </div>

              <div className="pt-2 pb-1 border-t">
                <p className="text-sm font-medium text-muted-foreground">Role Details</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Designation *</Label>
                  <Select value={form.designation} onValueChange={(v) => set({ designation: v as SupportingStaffDesignation })}>
                    <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                    <SelectContent>{designationContent}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Department</Label>
                  {departmentMode === "locked" ? (
                    <Input value={form.department || "-"} disabled />
                  ) : departmentMode === "library" ? (
                    <Input value="Library" disabled />
                  ) : (
                    <DepartmentSelect value={form.department} onChange={(v) => set({ department: v })} />
                  )}
                </div>
              </div>
              {form.designation === "OTHER" && (
                <div className="space-y-2">
                  <Label>Designation Title</Label>
                  <Input value={form.otherDesignationTitle} onChange={(e) => set({ otherDesignationTitle: e.target.value })} placeholder={otherDesignationPlaceholder} />
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="highestQualification">Highest Qualification *</Label>
                  <Input id="highestQualification" value={form.highestQualification} onChange={(e) => set({ highestQualification: e.target.value })} placeholder="e.g. Diploma, B.Com, ITI" />
                </div>
                <div className="space-y-2">
                  <Label>Status *</Label>
                  <Select value={form.status} onValueChange={(v) => set({ status: v as FacultyStatus })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(FACULTY_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="pt-2 pb-1 border-t">
                <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="joiningDate">Date of Joining *</Label>
                  <Input id="joiningDate" type="date" value={form.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} />
                  <p className="text-xs text-muted-foreground">Total Years of Experience is calculated automatically from this date.</p>
                </div>
              </div>

              <div className="pt-2 pb-1 border-t">
                <p className="text-sm font-medium text-muted-foreground">Contact Details</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Personal Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="mobileNo">Mobile No *</Label>
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
                  <Input id="mobileNo" value={form.mobileNo} onChange={(e) => set({ mobileNo: e.target.value })} placeholder="+91 98765 43210" />
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
            <Button type="button" variant="outline" onClick={() => router.push(afterSavePath)}>Cancel</Button>
            <Button type="submit" loading={saving}>Save Changes</Button>
          </div>
        </form>
      ) : (
        // Every other tab: the matching section editor plus its own Save, independent of every other tab.
        <Card className="shadow-xs border-border/80 overflow-hidden">
          <WizardStepHeader step={activeStep} />
          <CardContent className="p-5 sm:p-6 space-y-5">
            <SupportingStaffModuleEditor
              moduleKey={activeTab as SupportingStaffModuleKey}
              record={record}
              onChange={(patch) => setRecord((r) => ({ ...r, ...patch }))}
              collegeType={collegeType}
            />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.push(afterSavePath)}>Cancel</Button>
              <Button onClick={() => void handleSaveModule(activeTab as SupportingStaffModuleKey)} loading={savingModule === activeTab}>
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </WizardPage>
  );
}
