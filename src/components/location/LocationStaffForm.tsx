"use client";

import { useRef, useState } from "react";
import { Camera, CheckCircle2, FileBadge2, Shield, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { CameraCaptureModal } from "@/components/shared/CameraCaptureModal";
import type { LocationDepartment, LocationShift, LocationStaffMember } from "@/types/locationStaff";

const COMMON_ROLES = [
  "Security Guard",
  "Security Supervisor",
  "Housekeeping Staff",
  "Sweeper",
  "Electrician",
  "Plumber",
  "Driver",
  "Gardener",
  "Office Assistant",
  "Maintenance Technician",
  "Cook / Mess Staff",
  "Carpenter",
];

const PAYEE_OPTIONS = [
  { value: "Voucher Payee", label: "Voucher Payee", desc: "Paid through regular office petty/daily cash voucher" },
  { value: "Contract Payee", label: "Contract Payee", desc: "Outsourced or long-term third-party contract staff" },
];

interface LocationStaffFormProps {
  departments: LocationDepartment[];
  shifts: LocationShift[];
  // Set for the Location Dept Head context - department is fixed to their own
  // and the picker is replaced by a read-only display. Left unset for the
  // Location Staff Admin context, where any department (or none) is pickable.
  lockedDepartmentId?: string;
  lockedDepartmentName?: string;
  onSuccess: (staff: LocationStaffMember) => void;
  onCancel: () => void;
  submitLabel?: string;
}

// Shared "Add Location Staff Member" form - the single validated path both
// Location Staff Admin (location-staff-admin/staff/new) and Location Dept
// Head (location-dept-head/staff, inline dialog) submit through, instead of
// each maintaining its own copy with different fields and validation rigor.
export function LocationStaffForm({
  departments, shifts, lockedDepartmentId, lockedDepartmentName, onSuccess, onCancel, submitLabel = "Save Staff Member",
}: LocationStaffFormProps) {
  const [name, setName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [spouseGuardianName, setSpouseGuardianName] = useState("");
  const [spouseGuardianPhone, setSpouseGuardianPhone] = useState("");
  const [spouseGuardianAadhaar, setSpouseGuardianAadhaar] = useState("");
  const [address, setAddress] = useState("");
  const [payeeType, setPayeeType] = useState<string>("__none__");
  const [payeeReference, setPayeeReference] = useState("");
  const [role, setRole] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [departmentId, setDepartmentId] = useState<string>(lockedDepartmentId ?? "__none__");
  const [shiftId, setShiftId] = useState<string>("__none__");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) newErrors.name = "Full name is required";
    else if (name.trim().length < 2) newErrors.name = "Name must be at least 2 characters";

    if (!contactNumber.trim()) newErrors.contactNumber = "Contact number is required";
    else if (!/^[6-9]\d{9}$/.test(contactNumber.trim())) newErrors.contactNumber = "Enter a valid 10-digit mobile number (starts with 6-9)";

    if (!aadhaar.trim()) newErrors.aadhaar = "Aadhaar number is required";
    else if (!/^\d{12}$/.test(aadhaar.trim())) newErrors.aadhaar = "Aadhaar must be exactly 12 numeric digits";

    if (!payeeType || payeeType === "__none__") newErrors.payeeType = "Please select Payee Type (Voucher Payee or Contract Payee)";

    if (!role) newErrors.role = "Please select a role / designation";
    else if (role === "OTHER" && !customRole.trim()) newErrors.role = "Please specify the custom role title";

    if (spouseGuardianPhone.trim() && !/^[6-9]\d{9}$/.test(spouseGuardianPhone.trim())) {
      newErrors.spouseGuardianPhone = "Spouse/guardian phone must be a valid 10-digit number";
    }
    if (spouseGuardianAadhaar.trim() && !/^\d{12}$/.test(spouseGuardianAadhaar.trim())) {
      newErrors.spouseGuardianAadhaar = "Spouse/guardian Aadhaar must be exactly 12 digits";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const uploadPhotoFile = async (file: File) => {
    setIsUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/staff-photo", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Photo upload failed");
      setPhotoUrl(data.url);
      toast({ title: "Photo saved successfully" });
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadPhotoFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({
      name: true, contactNumber: true, aadhaar: true, payeeType: true, role: true,
      spouseGuardianPhone: true, spouseGuardianAadhaar: true,
    });
    if (!validate()) {
      toast({ variant: "destructive", title: "Validation Error", description: "Please fix the highlighted errors before submitting." });
      return;
    }

    const finalRole = role === "OTHER" ? customRole.trim() : role.trim();
    const finalPayee = payeeReference.trim() ? `${payeeType} (${payeeReference.trim()})` : payeeType;
    const finalDepartmentId = lockedDepartmentId ?? (departmentId !== "__none__" ? departmentId : "");

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/location/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          fatherName: fatherName.trim() || undefined,
          contactNumber: contactNumber.trim(),
          aadhaar: aadhaar.trim(),
          spouseGuardianName: spouseGuardianName.trim() || undefined,
          spouseGuardianPhone: spouseGuardianPhone.trim() || undefined,
          spouseGuardianAadhaar: spouseGuardianAadhaar.trim() || undefined,
          address: address.trim() || undefined,
          payeeVoucher: finalPayee,
          role: finalRole,
          departmentId: finalDepartmentId,
          shiftId: shiftId !== "__none__" ? shiftId : undefined,
          dateOfJoining: dateOfJoining || undefined,
          photoUrl: photoUrl || undefined,
          status: "ACTIVE" as const,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add staff member");
      toast({ title: "Staff Member Registered", description: `Successfully added ${name}.` });
      onSuccess(data as LocationStaffMember);
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Registration failed", description: err instanceof Error ? err.message : "Registration failed" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const applicableShifts = shifts.filter((s) => {
    if (!departmentId || departmentId === "__none__") return true;
    if (s.isCampusWide || s.departmentId === "ALL") return true;
    if (s.departmentId === departmentId) return true;
    if (Array.isArray(s.departmentIds) && (s.departmentIds.includes("ALL") || s.departmentIds.includes(departmentId))) {
      return true;
    }
    return false;
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* Photo Upload & Camera Capture */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-3.5 bg-muted/20 rounded-xl border">
        <div className="relative h-20 w-20 rounded-full bg-muted border-2 border-dashed border-border flex items-center justify-center overflow-hidden shrink-0 mx-auto sm:mx-0 shadow-xs">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="Preview" className="h-full w-full object-cover" />
          ) : (
            <Camera className="h-8 w-8 text-muted-foreground opacity-40" />
          )}
        </div>
        <div className="space-y-1.5 flex-1 text-center sm:text-left">
          <Label className="text-xs font-semibold text-foreground">Staff Profile Photo</Label>
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handlePhotoSelect}
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
            />
            {/* Upload File */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingPhoto}
              className="h-8 text-xs gap-1.5"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>{isUploadingPhoto ? "Uploading..." : photoUrl ? "Change File" : "Upload Photo"}</span>
            </Button>

            {/* Take Photo with Camera */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsCameraOpen(true)}
              disabled={isUploadingPhoto}
              className="h-8 text-xs gap-1.5 font-medium"
            >
              <Camera className="h-3.5 w-3.5 text-primary" />
              <span>Take Photo</span>
            </Button>

            {photoUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPhotoUrl("")}
                className="h-8 text-xs text-destructive hover:bg-destructive/10 gap-1"
              >
                <X className="h-3.5 w-3.5" />
                <span>Remove</span>
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Optional. Take a photo using camera or upload a file (PNG, JPG, WEBP up to 5 MB).
          </p>
        </div>
      </div>

      <CameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={uploadPhotoFile}
        title="Capture Staff Photo"
        description="Position the staff member's face in the frame and click capture."
      />

      {/* Identification */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-1 border-b">
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">1. Identification Details</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Full Name <span className="text-destructive">*</span></Label>
            <Input
              placeholder="e.g. Ramesh Kumar" value={name}
              onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((p) => ({ ...p, name: "" })); }}
              onBlur={() => setTouched((p) => ({ ...p, name: true }))}
              className={`h-9 text-xs ${errors.name && touched.name ? "border-destructive focus-visible:ring-destructive" : ""}`}
            />
            {errors.name && touched.name && <p className="text-[11px] text-destructive font-medium">{errors.name}</p>}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">Father&rsquo;s Name</Label>
              <span className="text-[10px] text-muted-foreground">Optional</span>
            </div>
            <Input placeholder="e.g. Suresh Kumar" value={fatherName} onChange={(e) => setFatherName(e.target.value)} className="h-9 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Contact Phone Number <span className="text-destructive">*</span></Label>
            <Input
              type="tel" placeholder="10-digit mobile (e.g. 9876543210)" value={contactNumber}
              onChange={(e) => { setContactNumber(e.target.value.replace(/\D/g, "").slice(0, 10)); if (errors.contactNumber) setErrors((p) => ({ ...p, contactNumber: "" })); }}
              onBlur={() => setTouched((p) => ({ ...p, contactNumber: true }))}
              className={`h-9 text-xs ${errors.contactNumber && touched.contactNumber ? "border-destructive focus-visible:ring-destructive" : ""}`}
            />
            {errors.contactNumber && touched.contactNumber && <p className="text-[11px] text-destructive font-medium">{errors.contactNumber}</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Aadhaar Number <span className="text-destructive">*</span></Label>
            <Input
              placeholder="12-digit Aadhaar number" value={aadhaar}
              onChange={(e) => { setAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12)); if (errors.aadhaar) setErrors((p) => ({ ...p, aadhaar: "" })); }}
              onBlur={() => setTouched((p) => ({ ...p, aadhaar: true }))}
              className={`h-9 text-xs font-mono tracking-wider ${errors.aadhaar && touched.aadhaar ? "border-destructive focus-visible:ring-destructive" : ""}`}
            />
            {errors.aadhaar && touched.aadhaar && <p className="text-[11px] text-destructive font-medium">{errors.aadhaar}</p>}
          </div>
        </div>
      </div>

      {/* Payee */}
      <div className="space-y-3 p-3.5 bg-muted/20 rounded-xl border">
        <div className="flex items-center gap-2 pb-1 border-b border-border/60">
          <FileBadge2 className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">2. Payee Category & Payroll</span>
          <Badge variant="outline" className="text-[10px] ml-auto">Required</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Payee Type <span className="text-destructive">*</span></Label>
            <Select value={payeeType} onValueChange={(v) => { setPayeeType(v); if (errors.payeeType) setErrors((p) => ({ ...p, payeeType: "" })); }}>
              <SelectTrigger className={`h-9 text-xs bg-card ${errors.payeeType && touched.payeeType ? "border-destructive focus-visible:ring-destructive" : ""}`}>
                <SelectValue placeholder="Select Payee Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>Select Payee Type...</SelectItem>
                {PAYEE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col py-0.5">
                      <span className="font-semibold text-xs">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.payeeType && touched.payeeType && <p className="text-[11px] text-destructive font-medium">{errors.payeeType}</p>}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">Voucher / Contract Reference</Label>
              <span className="text-[10px] text-muted-foreground">Optional</span>
            </div>
            <Input placeholder="e.g. VCH-004, Contract-2026-A" value={payeeReference} onChange={(e) => setPayeeReference(e.target.value)} className="h-9 text-xs" />
          </div>
        </div>
      </div>

      {/* Role, Department & Shift */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-1 border-b">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">3. Role & Campus Assignment</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Role / Designation <span className="text-destructive">*</span></Label>
            <Select value={role} onValueChange={(v) => { setRole(v); if (errors.role) setErrors((p) => ({ ...p, role: "" })); }}>
              <SelectTrigger className={`h-9 text-xs ${errors.role && touched.role ? "border-destructive focus-visible:ring-destructive" : ""}`}>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {COMMON_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                <SelectItem value="OTHER">Other (Custom Role)</SelectItem>
              </SelectContent>
            </Select>
            {role === "OTHER" && (
              <Input
                placeholder="Enter custom role title..." value={customRole}
                onChange={(e) => { setCustomRole(e.target.value); if (errors.role) setErrors((p) => ({ ...p, role: "" })); }}
                className="h-8 text-xs mt-1.5"
              />
            )}
            {errors.role && touched.role && <p className="text-[11px] text-destructive font-medium">{errors.role}</p>}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">Assigned Department</Label>
              {!lockedDepartmentId && <span className="text-[10px] text-muted-foreground">Can appoint as Head</span>}
            </div>
            {lockedDepartmentId ? (
              <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-xs text-foreground">
                {lockedDepartmentName ?? "Your department"}
              </div>
            ) : (
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Choose department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Leave Unassigned (Can assign later / Dept Head)</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">Assigned Shift</Label>
              <span className="text-[10px] text-muted-foreground">Optional</span>
            </div>
            <Select value={shiftId} onValueChange={setShiftId}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Choose shift (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Flexible / No Shift Assigned</SelectItem>
                {applicableShifts.map((s) => {
                  const isCampus = !!s.isCampusWide || s.departmentId === "ALL" || (Array.isArray(s.departmentIds) && s.departmentIds.includes("ALL"));
                  const isShared = !isCampus && Array.isArray(s.departmentIds) && s.departmentIds.length > 1;
                  const tag = isCampus ? " • Campus-wide" : isShared ? " • Shared" : "";
                  return (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.startTime} - {s.endTime}){tag}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">Date of Joining</Label>
              <span className="text-[10px] text-muted-foreground">Optional</span>
            </div>
            <Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} className="h-9 text-xs" />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="space-y-2">
        <div className="flex items-center justify-between pb-1 border-b">
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">4. Address</span>
          <span className="text-[10px] text-muted-foreground">Optional</span>
        </div>
        <Textarea rows={2} placeholder="Permanent residential address, street, town, pincode..." value={address} onChange={(e) => setAddress(e.target.value)} className="text-xs" />
      </div>

      {/* Spouse / Guardian */}
      <div className="space-y-3 p-3.5 bg-muted/20 rounded-xl border">
        <div className="flex items-center justify-between pb-1 border-b border-border/60">
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">5. Spouse / Guardian Details</span>
          <span className="text-[10px] text-muted-foreground">Optional</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Spouse / Guardian Name</Label>
            <Input placeholder="Name" value={spouseGuardianName} onChange={(e) => setSpouseGuardianName(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Contact Phone (10 digits)</Label>
            <Input
              type="tel" placeholder="10 digits" value={spouseGuardianPhone}
              onChange={(e) => { setSpouseGuardianPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); if (errors.spouseGuardianPhone) setErrors((p) => ({ ...p, spouseGuardianPhone: "" })); }}
              className={`h-8 text-xs ${errors.spouseGuardianPhone ? "border-destructive focus-visible:ring-destructive" : ""}`}
            />
            {errors.spouseGuardianPhone && <p className="text-[10px] text-destructive">{errors.spouseGuardianPhone}</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Aadhaar (12 digits)</Label>
            <Input
              placeholder="12 digits" value={spouseGuardianAadhaar}
              onChange={(e) => { setSpouseGuardianAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12)); if (errors.spouseGuardianAadhaar) setErrors((p) => ({ ...p, spouseGuardianAadhaar: "" })); }}
              className={`h-8 text-xs font-mono ${errors.spouseGuardianAadhaar ? "border-destructive focus-visible:ring-destructive" : ""}`}
            />
            {errors.spouseGuardianAadhaar && <p className="text-[10px] text-destructive">{errors.spouseGuardianAadhaar}</p>}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-3 border-t">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={isSubmitting} className="gap-1.5 font-semibold">
          <CheckCircle2 className="h-4 w-4" />
          <span>{isSubmitting ? "Registering Staff..." : submitLabel}</span>
        </Button>
      </div>
    </form>
  );
}
