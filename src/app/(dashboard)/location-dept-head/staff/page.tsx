"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Plus,
  Search,
  User,
  UsersRound,
  Eye,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { LocationDeptSwitcher } from "@/components/layout/LocationDeptSwitcher";
import type { LocationStaffMember, LocationShift } from "@/types/locationStaff";

export default function LocationStaffRosterPage() {
  const { activeDept, activeDeptId } = useActiveLocationDept();

  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedShift, setSelectedShift] = useState("ALL");
  const [selectedRole, setSelectedRole] = useState("ALL");

  // Modal states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<LocationStaffMember | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  // Form Fields
  const [name, setName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [spouseGuardianName, setSpouseGuardianName] = useState("");
  const [spouseGuardianPhone, setSpouseGuardianPhone] = useState("");
  const [spouseGuardianAadhaar, setSpouseGuardianAadhaar] = useState("");
  const [address, setAddress] = useState("");
  const [payeeVoucher, setPayeeVoucher] = useState("");
  const [role, setRole] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let isCancelled = false;
    if (!activeDeptId) {
      return;
    }

    Promise.all([
      fetch(`/api/location/staff?departmentId=${activeDeptId}&status=ALL`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => {
          if (!isCancelled) setStaffList(d.staff ?? []);
        }),
      fetch(`/api/location/shifts?departmentId=${activeDeptId}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
        .then((d) => {
          if (!isCancelled) setShifts(d.shifts ?? []);
        }),
    ])
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load staff roster" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeDeptId, refreshKey]);

  // Handle Photo Upload
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
      toast({ title: "Photo uploaded" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast({ variant: "destructive", title: "Upload failed", description: msg });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const resetForm = () => {
    setName("");
    setFatherName("");
    setContactNumber("");
    setAadhaar("");
    setSpouseGuardianName("");
    setSpouseGuardianPhone("");
    setSpouseGuardianAadhaar("");
    setAddress("");
    setPayeeVoucher("");
    setRole("");
    setShiftId("");
    setPhotoUrl("");
  };

  // Add / Save Staff
  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDeptId) return;

    if (!name.trim() || !contactNumber.trim() || !aadhaar.trim() || !payeeVoucher.trim() || !role.trim()) {
      toast({ variant: "destructive", title: "Missing details", description: "Please fill Name, Contact Number, Aadhaar, Role, and Payee." });
      return;
    }

    if (!/^\d{10}$/.test(contactNumber.trim())) {
      toast({ variant: "destructive", title: "Invalid Contact", description: "Contact number must be exactly 10 digits." });
      return;
    }

    if (!/^\d{12}$/.test(aadhaar.trim())) {
      toast({ variant: "destructive", title: "Invalid Aadhaar", description: "Aadhaar must be exactly 12 numeric digits." });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/location/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: activeDeptId,
          name: name.trim(),
          fatherName: fatherName.trim() || undefined,
          contactNumber: contactNumber.trim(),
          aadhaar: aadhaar.trim(),
          spouseGuardianName: spouseGuardianName.trim() || undefined,
          spouseGuardianPhone: spouseGuardianPhone.trim() || undefined,
          spouseGuardianAadhaar: spouseGuardianAadhaar.trim() || undefined,
          address: address.trim() || undefined,
          payeeVoucher: payeeVoucher.trim(),
          role: role.trim(),
          shiftId: shiftId && shiftId !== "__none__" ? shiftId : undefined,
          photoUrl: photoUrl || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create staff member");

      toast({ title: "Success", description: `Added ${name} to department roster` });
      setIsAddOpen(false);
      resetForm();
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add staff";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter staff list
  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      if (selectedShift !== "ALL" && s.shiftId !== selectedShift) return false;
      if (selectedRole !== "ALL" && s.role !== selectedRole) return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return (
          s.name.toLowerCase().includes(q) ||
          s.contactNumber.includes(q) ||
          s.aadhaar.includes(q) ||
          s.role.toLowerCase().includes(q) ||
          s.payeeVoucher.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [staffList, selectedShift, selectedRole, search]);

  const uniqueRoles = useMemo(() => {
    return Array.from(new Set(staffList.map((s) => s.role).filter(Boolean)));
  }, [staffList]);

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-3 sm:p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-dept-head">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Department Staff Roster</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span>{activeDept?.name ?? "Department"}</span> · {staffList.length} Total Members
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <LocationDeptSwitcher />
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setIsAddOpen(true);
            }}
            className="rounded-full gap-1.5 h-9 text-xs font-semibold px-4 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Add Staff</span>
          </Button>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-card p-3 rounded-xl border shadow-xs">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, Aadhaar, role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs rounded-xl"
          />
        </div>

        {/* Shift Filter */}
        <Select value={selectedShift} onValueChange={setSelectedShift}>
          <SelectTrigger className="h-9 text-xs rounded-xl">
            <SelectValue placeholder="Filter by Shift" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Shifts</SelectItem>
            {shifts.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.startTime} - {s.endTime})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Role Filter */}
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger className="h-9 text-xs rounded-xl">
            <SelectValue placeholder="Filter by Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Roles</SelectItem>
            {uniqueRoles.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Staff List Roster ── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl border bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <UsersRound className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="font-semibold text-foreground text-sm">No staff members found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click &ldquo;Add Staff&rdquo; above to register members for {activeDept?.name ?? "this department"}.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredStaff.map((staff) => (
            <Card
              key={staff.id}
              className="border-border/80 shadow-xs hover:border-primary/40 transition-colors cursor-pointer"
              onClick={() => {
                setSelectedStaff(staff);
                setIsViewOpen(true);
              }}
            >
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-sm">
                      {staff.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover" />
                      ) : (
                        staff.name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-sm text-foreground truncate">{staff.name}</h3>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
                          {staff.role}
                        </Badge>
                        {staff.status === "ACTIVE" ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Active" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" title="Inactive" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        Father: {staff.fatherName} · Phone: {staff.contactNumber}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1 flex-wrap">
                        <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">
                          Aadhaar: {staff.aadhaar.slice(0, 4)}••••{staff.aadhaar.slice(-4)}
                        </span>
                        <span>Payee: <strong className="text-foreground">{staff.payeeVoucher}</strong></span>
                        {staff.shiftName && (
                          <span className="text-primary font-medium">· Shift: {staff.shiftName}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground shrink-0">
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Add Staff Dialog ── */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Add Staff Member</DialogTitle>
            <DialogDescription className="text-xs">
              Register a new employee for {activeDept?.name ?? "Department"}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveStaff} className="space-y-4 pt-2">
            {/* Photo Upload Box */}
            <div className="flex items-center gap-4 bg-muted/30 p-3 rounded-xl border border-dashed border-border">
              <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-base">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt="Staff Preview" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-7 w-7 text-primary/60" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-foreground">Staff Photo</p>
                <p className="text-[11px] text-muted-foreground mb-2">Upload a clear photo (JPG/PNG max 5MB)</p>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  ref={fileInputRef}
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isUploadingPhoto}
                  onClick={() => fileInputRef.current?.click()}
                  className="h-7 text-xs gap-1.5"
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span>{isUploadingPhoto ? "Uploading..." : photoUrl ? "Change Photo" : "Upload Photo"}</span>
                </Button>
              </div>
            </div>

            {/* Personal Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Full Name *</Label>
                <Input
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Father&rsquo;s Name *</Label>
                <Input
                  placeholder="e.g. Suresh Kumar"
                  value={fatherName}
                  onChange={(e) => setFatherName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Contact Number *</Label>
                <Input
                  required
                  type="tel"
                  placeholder="10-digit mobile"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Aadhaar Number *</Label>
                <Input
                  required
                  placeholder="12-digit Aadhaar"
                  value={aadhaar}
                  onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            {/* Role & Payee/Voucher */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Role *</Label>
                <Input
                  required
                  placeholder="e.g. Security Guard, Driver"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Payee Category *</Label>
                <Select value={payeeVoucher} onValueChange={setPayeeVoucher}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select Payee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Voucher Payee">Voucher Payee</SelectItem>
                    <SelectItem value="Contract Payee">Contract Payee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Shift Assignment */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Default Shift (Optional)</Label>
              <Select value={shiftId} onValueChange={setShiftId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Assign a Shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (Flexible)</SelectItem>
                  {shifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.startTime} - {s.endTime})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Spouse / Guardian Details */}
            <div className="p-3 bg-muted/20 rounded-xl border space-y-2.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Spouse / Guardian Information (Optional)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Input
                  placeholder="Guardian Name"
                  value={spouseGuardianName}
                  onChange={(e) => setSpouseGuardianName(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="Guardian Phone"
                  type="tel"
                  value={spouseGuardianPhone}
                  onChange={(e) => setSpouseGuardianPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="h-8 text-xs"
                />
              </div>

              <Input
                placeholder="Guardian Aadhaar (12 digits)"
                value={spouseGuardianAadhaar}
                onChange={(e) => setSpouseGuardianAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12))}
                className="h-8 text-xs font-mono"
              />
            </div>

            {/* Address */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Address</Label>
                <span className="text-[10px] text-muted-foreground">Optional</span>
              </div>
              <Textarea
                rows={2}
                placeholder="Residential / Local address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Staff Member"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── View Staff Profile Drawer / Modal ── */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto p-5">
          {selectedStaff && (
            <div className="space-y-4">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-xl">
                    {selectedStaff.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={selectedStaff.photoUrl} alt={selectedStaff.name} className="h-full w-full object-cover" />
                    ) : (
                      selectedStaff.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <DialogTitle className="text-base font-bold">{selectedStaff.name}</DialogTitle>
                    <Badge variant="outline" className="text-xs mt-1 border-primary/30 text-primary">
                      {selectedStaff.role}
                    </Badge>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-3 pt-2 text-xs divide-y divide-border/50">
                <div className="space-y-1.5 pb-2">
                  <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                    Personal Details
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Father&rsquo;s Name:</span>
                      <strong className="text-foreground">{selectedStaff.fatherName}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Contact Number:</span>
                      <strong className="text-foreground">{selectedStaff.contactNumber}</strong>
                    </div>
                  </div>
                  <div className="mt-2">
                    <span className="text-muted-foreground block text-[11px]">Aadhaar Number:</span>
                    <strong className="font-mono text-foreground text-sm tracking-wide">{selectedStaff.aadhaar}</strong>
                  </div>
                  <div className="mt-2">
                    <span className="text-muted-foreground block text-[11px]">Address:</span>
                    <p className="text-foreground">{selectedStaff.address}</p>
                  </div>
                </div>

                <div className="space-y-1.5 py-2">
                  <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                    Work & Payroll
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Payee / Voucher:</span>
                      <strong className="text-foreground">{selectedStaff.payeeVoucher}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Shift:</span>
                      <strong className="text-foreground">{selectedStaff.shiftName || "Flexible"}</strong>
                    </div>
                  </div>
                </div>

                {(selectedStaff.spouseGuardianName || selectedStaff.spouseGuardianPhone || selectedStaff.spouseGuardianAadhaar) && (
                  <div className="space-y-1.5 pt-2">
                    <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                      Spouse / Guardian Information
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Name:</span>
                        <strong className="text-foreground">{selectedStaff.spouseGuardianName || "—"}</strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Phone:</span>
                        <strong className="text-foreground">{selectedStaff.spouseGuardianPhone || "—"}</strong>
                      </div>
                    </div>
                    {selectedStaff.spouseGuardianAadhaar && (
                      <div className="mt-1">
                        <span className="text-muted-foreground block text-[11px]">Aadhaar:</span>
                        <strong className="font-mono text-foreground">{selectedStaff.spouseGuardianAadhaar}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter className="pt-2">
                <Button size="sm" variant="outline" onClick={() => setIsViewOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
