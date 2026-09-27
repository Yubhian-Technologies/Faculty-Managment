"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileBadge2,
  Shield,
  UserPlus,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment, LocationShift } from "@/types/locationStaff";

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

export default function NewStaffMemberPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Form Fields
  const [name, setName] = useState("");
  const [fatherName, setFatherName] = useState(""); // OPTIONAL
  const [contactNumber, setContactNumber] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [spouseGuardianName, setSpouseGuardianName] = useState("");
  const [spouseGuardianPhone, setSpouseGuardianPhone] = useState("");
  const [spouseGuardianAadhaar, setSpouseGuardianAadhaar] = useState("");
  const [address, setAddress] = useState(""); // OPTIONAL
  const [payeeType, setPayeeType] = useState<string>("__none__"); // "Voucher Payee" | "Contract Payee"
  const [payeeReference, setPayeeReference] = useState("");
  const [role, setRole] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("__none__");
  const [shiftId, setShiftId] = useState<string>("__none__");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  // Validation Errors state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      fetch(`/api/location/departments`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
        .then((d) => {
          if (!isCancelled) setDepartments(d.departments ?? []);
        }),
      fetch(`/api/location/shifts`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
        .then((d) => {
          if (!isCancelled) setShifts(d.shifts ?? []);
        }),
    ])
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load departments/shifts" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const markTouched = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Name: required, min 2 chars
    if (!name.trim()) {
      newErrors.name = "Full name is required";
    } else if (name.trim().length < 2) {
      newErrors.name = "Name must be at least 2 characters";
    }

    // Contact Number: required, exactly 10 digits
    if (!contactNumber.trim()) {
      newErrors.contactNumber = "Contact number is required";
    } else if (!/^[6-9]\d{9}$/.test(contactNumber.trim())) {
      newErrors.contactNumber = "Enter a valid 10-digit mobile number (starts with 6-9)";
    }

    // Aadhaar: required, exactly 12 numeric digits
    if (!aadhaar.trim()) {
      newErrors.aadhaar = "Aadhaar number is required";
    } else if (!/^\d{12}$/.test(aadhaar.trim())) {
      newErrors.aadhaar = "Aadhaar must be exactly 12 numeric digits";
    }

    // Payee Type: required
    if (!payeeType || payeeType === "__none__") {
      newErrors.payeeType = "Please select Payee Type (Voucher Payee or Contract Payee)";
    }

    // Role: required
    if (!role) {
      newErrors.role = "Please select a role / designation";
    } else if (role === "OTHER" && !customRole.trim()) {
      newErrors.role = "Please specify the custom role title";
    }

    // Spouse Guardian Phone: optional, but 10 digits if provided
    if (spouseGuardianPhone.trim() && !/^[6-9]\d{9}$/.test(spouseGuardianPhone.trim())) {
      newErrors.spouseGuardianPhone = "Spouse/guardian phone must be a valid 10-digit number";
    }

    // Spouse Guardian Aadhaar: optional, but 12 digits if provided
    if (spouseGuardianAadhaar.trim() && !/^\d{12}$/.test(spouseGuardianAadhaar.trim())) {
      newErrors.spouseGuardianAadhaar = "Spouse/guardian Aadhaar must be exactly 12 digits";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/upload/staff-photo", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Photo upload failed");

      setPhotoUrl(data.url);
      toast({ title: "Photo uploaded successfully" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast({ variant: "destructive", title: "Upload failed", description: msg });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mark all fields as touched for instant visual feedback
    setTouched({
      name: true,
      contactNumber: true,
      aadhaar: true,
      payeeType: true,
      role: true,
      spouseGuardianPhone: true,
      spouseGuardianAadhaar: true,
    });

    if (!validate()) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please fix the highlighted errors before submitting.",
      });
      return;
    }

    const finalRole = role === "OTHER" ? customRole.trim() : role.trim();
    const finalPayee = payeeReference.trim()
      ? `${payeeType} (${payeeReference.trim()})`
      : payeeType;

    setIsSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        fatherName: fatherName.trim() || undefined, // Optional
        contactNumber: contactNumber.trim(),
        aadhaar: aadhaar.trim(),
        spouseGuardianName: spouseGuardianName.trim() || undefined,
        spouseGuardianPhone: spouseGuardianPhone.trim() || undefined,
        spouseGuardianAadhaar: spouseGuardianAadhaar.trim() || undefined,
        address: address.trim() || undefined, // Optional
        payeeVoucher: finalPayee,
        role: finalRole,
        departmentId: departmentId !== "__none__" ? departmentId : "",
        shiftId: shiftId !== "__none__" ? shiftId : undefined,
        dateOfJoining: dateOfJoining || undefined,
        photoUrl: photoUrl || undefined,
        status: "ACTIVE" as const,
      };

      const res = await fetch("/api/location/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add staff member");

      toast({
        title: "Staff Member Registered",
        description: `Successfully added ${name}. They can now be assigned to departments or selected as Department Head.`,
      });
      router.push("/location-staff-admin/staff");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      toast({ variant: "destructive", title: "Registration failed", description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-24 md:pb-8">
      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between gap-3 bg-card p-4 rounded-xl border shadow-xs">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-staff-admin/staff">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              <span>Add New Staff Member</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Register non-teaching campus staff. Added staff members can also be appointed as Department Heads.
            </p>
          </div>
        </div>
      </div>

      <Card className="border shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Staff Registration Form</CardTitle>
          <CardDescription className="text-xs">
            Fields marked with an asterisk (<span className="text-destructive font-bold">*</span>) are mandatory. Father&rsquo;s Name and Address are optional.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Photo Upload Section */}
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
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handlePhotoSelect}
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingPhoto}
                    className="h-8 text-xs gap-1.5"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>{isUploadingPhoto ? "Uploading..." : photoUrl ? "Change Photo" : "Upload Photo"}</span>
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
                  Optional. Supported formats: PNG, JPG, WEBP up to 5 MB.
                </p>
              </div>
            </div>

            {/* Basic Identification */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  1. Identification Details
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Full Name */}
                <div className="space-y-1">
                  <Label htmlFor="staff-name" className="text-xs font-medium">
                    Full Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="staff-name"
                    required
                    placeholder="e.g. Ramesh Kumar"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (errors.name) setErrors((prev) => ({ ...prev, name: "" }));
                    }}
                    onBlur={() => {
                      markTouched("name");
                      if (!name.trim()) {
                        setErrors((prev) => ({ ...prev, name: "Full name is required" }));
                      } else if (name.trim().length < 2) {
                        setErrors((prev) => ({ ...prev, name: "Name must be at least 2 characters" }));
                      }
                    }}
                    className={`h-9 text-xs ${errors.name && touched.name ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  />
                  {errors.name && touched.name && (
                    <p className="text-[11px] text-destructive font-medium">{errors.name}</p>
                  )}
                </div>

                {/* Father's Name (Optional) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="staff-father-name" className="text-xs font-medium text-foreground">
                      Father&rsquo;s Name
                    </Label>
                    <span className="text-[10px] text-muted-foreground">Optional</span>
                  </div>
                  <Input
                    id="staff-father-name"
                    placeholder="e.g. Suresh Kumar"
                    value={fatherName}
                    onChange={(e) => setFatherName(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>

                {/* Contact Number */}
                <div className="space-y-1">
                  <Label htmlFor="staff-contact" className="text-xs font-medium">
                    Contact Phone Number <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="staff-contact"
                    required
                    type="tel"
                    placeholder="10-digit mobile (e.g. 9876543210)"
                    value={contactNumber}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                      setContactNumber(val);
                      if (errors.contactNumber) setErrors((prev) => ({ ...prev, contactNumber: "" }));
                    }}
                    onBlur={() => {
                      markTouched("contactNumber");
                      if (!contactNumber.trim()) {
                        setErrors((prev) => ({ ...prev, contactNumber: "Contact number is required" }));
                      } else if (!/^[6-9]\d{9}$/.test(contactNumber.trim())) {
                        setErrors((prev) => ({ ...prev, contactNumber: "Enter a valid 10-digit mobile number" }));
                      }
                    }}
                    className={`h-9 text-xs ${errors.contactNumber && touched.contactNumber ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  />
                  {errors.contactNumber && touched.contactNumber && (
                    <p className="text-[11px] text-destructive font-medium">{errors.contactNumber}</p>
                  )}
                </div>

                {/* Aadhaar Number */}
                <div className="space-y-1">
                  <Label htmlFor="staff-aadhaar" className="text-xs font-medium">
                    Aadhaar Number <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="staff-aadhaar"
                    required
                    placeholder="12-digit Aadhaar number"
                    value={aadhaar}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 12);
                      setAadhaar(val);
                      if (errors.aadhaar) setErrors((prev) => ({ ...prev, aadhaar: "" }));
                    }}
                    onBlur={() => {
                      markTouched("aadhaar");
                      if (!aadhaar.trim()) {
                        setErrors((prev) => ({ ...prev, aadhaar: "Aadhaar number is required" }));
                      } else if (!/^\d{12}$/.test(aadhaar.trim())) {
                        setErrors((prev) => ({ ...prev, aadhaar: "Aadhaar must be exactly 12 digits" }));
                      }
                    }}
                    className={`h-9 text-xs font-mono tracking-wider ${errors.aadhaar && touched.aadhaar ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  />
                  {errors.aadhaar && touched.aadhaar && (
                    <p className="text-[11px] text-destructive font-medium">{errors.aadhaar}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Payee Selection (Voucher Payee vs Contract Payee) */}
            <div className="space-y-3 p-3.5 bg-muted/20 rounded-xl border">
              <div className="flex items-center gap-2 pb-1 border-b border-border/60">
                <FileBadge2 className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  2. Payee Category & Payroll
                </span>
                <Badge variant="outline" className="text-[10px] ml-auto">
                  Required
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Payee Dropdown */}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    Payee Type <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={payeeType}
                    onValueChange={(val) => {
                      setPayeeType(val);
                      if (errors.payeeType) setErrors((prev) => ({ ...prev, payeeType: "" }));
                    }}
                  >
                    <SelectTrigger
                      className={`h-9 text-xs bg-card ${
                        errors.payeeType && touched.payeeType
                          ? "border-destructive focus-visible:ring-destructive"
                          : ""
                      }`}
                    >
                      <SelectValue placeholder="Select Payee Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" disabled>
                        Select Payee Type...
                      </SelectItem>
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
                  {errors.payeeType && touched.payeeType && (
                    <p className="text-[11px] text-destructive font-medium">{errors.payeeType}</p>
                  )}
                </div>

                {/* Payee / Voucher Reference (Optional) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="payee-ref" className="text-xs font-medium text-foreground">
                      Voucher / Contract Reference
                    </Label>
                    <span className="text-[10px] text-muted-foreground">Optional</span>
                  </div>
                  <Input
                    id="payee-ref"
                    placeholder="e.g. VCH-004, Daily Voucher, Contract-2026-A"
                    value={payeeReference}
                    onChange={(e) => setPayeeReference(e.target.value)}
                    className="h-9 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Optional reference note or vendor/voucher identifier.
                  </p>
                </div>
              </div>
            </div>

            {/* Role, Department & Shift */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b">
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  3. Role & Campus Assignment
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Role / Designation */}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    Role / Designation <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={role}
                    onValueChange={(val) => {
                      setRole(val);
                      if (errors.role) setErrors((prev) => ({ ...prev, role: "" }));
                    }}
                  >
                    <SelectTrigger
                      className={`h-9 text-xs ${
                        errors.role && touched.role ? "border-destructive focus-visible:ring-destructive" : ""
                      }`}
                    >
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                      <SelectItem value="OTHER">Other (Custom Role)</SelectItem>
                    </SelectContent>
                  </Select>

                  {role === "OTHER" && (
                    <Input
                      placeholder="Enter custom role title..."
                      value={customRole}
                      onChange={(e) => {
                        setCustomRole(e.target.value);
                        if (errors.role) setErrors((prev) => ({ ...prev, role: "" }));
                      }}
                      className="h-8 text-xs mt-1.5"
                    />
                  )}
                  {errors.role && touched.role && (
                    <p className="text-[11px] text-destructive font-medium">{errors.role}</p>
                  )}
                </div>

                {/* Department Selection */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-foreground">Assigned Department</Label>
                    <span className="text-[10px] text-muted-foreground">Can appoint as Head</span>
                  </div>
                  <Select value={departmentId} onValueChange={setDepartmentId}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Choose department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        Leave Unassigned (Can assign later / Dept Head)
                      </SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} {d.code ? `(${d.code})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Shift Selection */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-foreground">Assigned Shift</Label>
                    <span className="text-[10px] text-muted-foreground">Optional</span>
                  </div>
                  <Select value={shiftId} onValueChange={setShiftId}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Choose shift (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Flexible / No Shift Assigned</SelectItem>
                      {shifts.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.startTime} - {s.endTime})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Date of Joining */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-foreground">Date of Joining</Label>
                    <span className="text-[10px] text-muted-foreground">Optional</span>
                  </div>
                  <Input
                    type="date"
                    value={dateOfJoining}
                    onChange={(e) => setDateOfJoining(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Residential Address (Optional) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-1 border-b">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  4. Address
                </span>
                <span className="text-[10px] text-muted-foreground">Optional</span>
              </div>

              <div className="space-y-1">
                <Label htmlFor="staff-address" className="text-xs font-medium text-foreground">
                  Residential Address
                </Label>
                <Textarea
                  id="staff-address"
                  rows={2}
                  placeholder="Permanent residential address, street, town, pincode..."
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            {/* Spouse / Guardian Information (Optional) */}
            <div className="space-y-3 p-3.5 bg-muted/20 rounded-xl border">
              <div className="flex items-center justify-between pb-1 border-b border-border/60">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  5. Spouse / Guardian Details
                </span>
                <span className="text-[10px] text-muted-foreground">Optional</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="space-y-1">
                  <Label htmlFor="guardian-name" className="text-[11px] text-muted-foreground">
                    Spouse / Guardian Name
                  </Label>
                  <Input
                    id="guardian-name"
                    placeholder="Name"
                    value={spouseGuardianName}
                    onChange={(e) => setSpouseGuardianName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="guardian-phone" className="text-[11px] text-muted-foreground">
                    Contact Phone (10 digits)
                  </Label>
                  <Input
                    id="guardian-phone"
                    type="tel"
                    placeholder="10 digits"
                    value={spouseGuardianPhone}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                      setSpouseGuardianPhone(val);
                      if (errors.spouseGuardianPhone) {
                        setErrors((prev) => ({ ...prev, spouseGuardianPhone: "" }));
                      }
                    }}
                    onBlur={() => {
                      if (spouseGuardianPhone.trim() && !/^[6-9]\d{9}$/.test(spouseGuardianPhone.trim())) {
                        setErrors((prev) => ({
                          ...prev,
                          spouseGuardianPhone: "Valid 10 digits required",
                        }));
                      }
                    }}
                    className={`h-8 text-xs ${
                      errors.spouseGuardianPhone ? "border-destructive focus-visible:ring-destructive" : ""
                    }`}
                  />
                  {errors.spouseGuardianPhone && (
                    <p className="text-[10px] text-destructive">{errors.spouseGuardianPhone}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="guardian-aadhaar" className="text-[11px] text-muted-foreground">
                    Aadhaar (12 digits)
                  </Label>
                  <Input
                    id="guardian-aadhaar"
                    placeholder="12 digits"
                    value={spouseGuardianAadhaar}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 12);
                      setSpouseGuardianAadhaar(val);
                      if (errors.spouseGuardianAadhaar) {
                        setErrors((prev) => ({ ...prev, spouseGuardianAadhaar: "" }));
                      }
                    }}
                    onBlur={() => {
                      if (spouseGuardianAadhaar.trim() && !/^\d{12}$/.test(spouseGuardianAadhaar.trim())) {
                        setErrors((prev) => ({
                          ...prev,
                          spouseGuardianAadhaar: "Exact 12 digits required",
                        }));
                      }
                    }}
                    className={`h-8 text-xs font-mono ${
                      errors.spouseGuardianAadhaar ? "border-destructive focus-visible:ring-destructive" : ""
                    }`}
                  />
                  {errors.spouseGuardianAadhaar && (
                    <p className="text-[10px] text-destructive">{errors.spouseGuardianAadhaar}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t">
              <Button asChild type="button" variant="outline" size="sm">
                <Link href="/location-staff-admin/staff">Cancel</Link>
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting || isLoading} className="gap-1.5 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                <span>{isSubmitting ? "Registering Staff..." : "Save Staff Member"}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
