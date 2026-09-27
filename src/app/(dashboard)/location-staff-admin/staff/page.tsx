"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileBadge2,
  Plus,
  Search,
  Shield,
  UsersRound,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { LocationStaffMember, LocationDepartment, LocationShift } from "@/types/locationStaff";

export default function CampusStaffDirectoryPage() {
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedDeptId, setSelectedDeptId] = useState("ALL");
  const [selectedRole, setSelectedRole] = useState("ALL");
  const [selectedShiftId, setSelectedShiftId] = useState("ALL");
  const [selectedPayee, setSelectedPayee] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ACTIVE");

  // Profile modal
  const [selectedStaff, setSelectedStaff] = useState<LocationStaffMember | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      fetch(`/api/location/staff?status=ALL`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => {
          if (!isCancelled) setStaffList(d.staff ?? []);
        }),
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
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load directory" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Filtered staff
  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      if (selectedDeptId !== "ALL" && s.departmentId !== selectedDeptId) return false;
      if (selectedRole !== "ALL" && s.role !== selectedRole) return false;
      if (selectedShiftId !== "ALL" && s.shiftId !== selectedShiftId) return false;
      if (selectedStatus !== "ALL" && s.status !== selectedStatus) return false;
      if (selectedPayee !== "ALL") {
        const p = s.payeeVoucher?.toLowerCase() || "";
        if (selectedPayee === "VOUCHER" && !p.includes("voucher")) return false;
        if (selectedPayee === "CONTRACT" && !p.includes("contract")) return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return (
          s.name.toLowerCase().includes(q) ||
          s.fatherName?.toLowerCase().includes(q) ||
          s.contactNumber?.includes(q) ||
          s.aadhaar?.includes(q) ||
          s.role?.toLowerCase().includes(q) ||
          s.departmentName?.toLowerCase().includes(q) ||
          s.payeeVoucher?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [staffList, selectedDeptId, selectedRole, selectedShiftId, selectedStatus, selectedPayee, search]);

  const uniqueRoles = useMemo(() => {
    return Array.from(new Set(staffList.map((s) => s.role).filter(Boolean)));
  }, [staffList]);

  // Map department head for profile view
  const activeDeptForProfile = useMemo(() => {
    if (!selectedStaff) return null;
    return departments.find((d) => d.id === selectedStaff.departmentId) ?? null;
  }, [departments, selectedStaff]);

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border shadow-xs">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-staff-admin">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Campus Staff Directory</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Comprehensive registry of all location departments, supervising heads, and staff profiles.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs px-2.5 py-1">
            {filteredStaff.length} of {staffList.length} Staff Shown
          </Badge>
          <Button
            asChild
            size="sm"
            className="rounded-full gap-1.5 h-9 text-xs font-semibold px-4 shadow-sm"
          >
            <Link href="/location-staff-admin/staff/new">
              <Plus className="h-4 w-4" />
              <span>Add Staff Member</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 bg-card p-3 rounded-xl border shadow-xs">
        {/* Search */}
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, Aadhaar, role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs rounded-xl"
          />
        </div>

        {/* Department Filter */}
        <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
          <SelectTrigger className="h-9 text-xs rounded-xl">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name} {d.code && `(${d.code})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Role Filter */}
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger className="h-9 text-xs rounded-xl">
            <SelectValue placeholder="All Roles" />
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

        {/* Payee Type Filter */}
        <Select value={selectedPayee} onValueChange={setSelectedPayee}>
          <SelectTrigger className="h-9 text-xs rounded-xl">
            <SelectValue placeholder="Payee Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Payees</SelectItem>
            <SelectItem value="VOUCHER">Voucher Payee</SelectItem>
            <SelectItem value="CONTRACT">Contract Payee</SelectItem>
          </SelectContent>
        </Select>

        {/* Shift Filter */}
        <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
          <SelectTrigger className="h-9 text-xs rounded-xl">
            <SelectValue placeholder="All Shifts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Shifts</SelectItem>
            {shifts.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.startTime}-{s.endTime})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status Filter */}
        <Select value={selectedStatus} onValueChange={setSelectedStatus}>
          <SelectTrigger className="h-9 text-xs rounded-xl">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="ACTIVE">Active Only</SelectItem>
            <SelectItem value="INACTIVE">Inactive Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Staff Grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-36 rounded-xl border bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <UsersRound className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="font-semibold text-foreground text-sm">No staff members found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add staff members to assign them to shifts and departments, or appoint as Department Heads.
          </p>
          <Button asChild size="sm" className="mt-3 text-xs rounded-full gap-1.5">
            <Link href="/location-staff-admin/staff/new">
              <Plus className="h-3.5 w-3.5" />
              <span>Add Staff Member</span>
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredStaff.map((staff) => {
            const isHead =
              staff.isDeptHead ||
              departments.some((d) => d.headStaffId === staff.id || d.headUid === staff.id);
            return (
              <Card
                key={staff.id}
                className="border-border/80 shadow-xs hover:border-primary/40 transition-colors cursor-pointer flex flex-col justify-between"
                onClick={() => {
                  setSelectedStaff(staff);
                  setIsProfileOpen(true);
                }}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-sm">
                      {staff.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover" />
                      ) : (
                        staff.name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <h3 className="font-bold text-sm text-foreground truncate">{staff.name}</h3>
                        <div className="flex items-center gap-1 shrink-0">
                          {isHead && (
                            <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] px-1.5 py-0 flex items-center gap-0.5">
                              <Shield className="h-2.5 w-2.5" />
                              <span>Head</span>
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
                            {staff.role}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {staff.departmentName || "Unassigned Department"}
                      </p>
                      {staff.fatherName && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          Father: {staff.fatherName}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/50 text-[11px] text-muted-foreground space-y-1">
                    <div className="flex items-center justify-between">
                      <span>Phone:</span>
                      <strong className="text-foreground">{staff.contactNumber}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Aadhaar:</span>
                      <span className="font-mono text-foreground">
                        {staff.aadhaar?.slice(0, 4)}••••{staff.aadhaar?.slice(-4)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <FileBadge2 className="h-3 w-3 text-muted-foreground" />
                        <span>Payee:</span>
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${
                          staff.payeeVoucher?.toLowerCase().includes("contract")
                            ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                            : "bg-blue-500/10 text-blue-600 border-blue-500/20"
                        }`}
                      >
                        {staff.payeeVoucher || "Voucher Payee"}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Full Staff Profile Drawer / Modal ── */}
      <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-5">
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
                    <div className="flex items-center gap-2">
                      <DialogTitle className="text-base font-bold">{selectedStaff.name}</DialogTitle>
                      {selectedStaff.status === "ACTIVE" ? (
                        <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0">Active</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inactive</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                        {selectedStaff.role}
                      </Badge>
                      <span className="text-xs text-muted-foreground">· {selectedStaff.departmentName || "Unassigned"}</span>
                      {(selectedStaff.isDeptHead || departments.some((d) => d.headStaffId === selectedStaff.id || d.headUid === selectedStaff.id)) && (
                        <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] px-1.5 py-0 flex items-center gap-1">
                          <Shield className="h-3 w-3" />
                          <span>Department Head</span>
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-3 pt-2 text-xs divide-y divide-border/50">
                {/* Department & Supervising Head */}
                <div className="space-y-1.5 pb-2">
                  <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block">
                    Department & Supervision
                  </span>
                  <div className="grid grid-cols-2 gap-2 bg-muted/30 p-2.5 rounded-lg border border-border/50">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Department:</span>
                      <strong className="text-foreground">{selectedStaff.departmentName || "Unassigned"}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Supervising Head:</span>
                      <strong className="text-foreground">
                        {activeDeptForProfile?.headName || "Unassigned"}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Personal Information */}
                <div className="space-y-1.5 py-2">
                  <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block">
                    Personal Information
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Father&rsquo;s Name:</span>
                      <strong className="text-foreground">{selectedStaff.fatherName || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Contact Number:</span>
                      <strong className="text-foreground">{selectedStaff.contactNumber}</strong>
                    </div>
                  </div>

                  <div className="mt-2">
                    <span className="text-muted-foreground block text-[11px]">Aadhaar Number:</span>
                    <strong className="font-mono text-foreground text-sm tracking-wider">{selectedStaff.aadhaar}</strong>
                  </div>

                  <div className="mt-2">
                    <span className="text-muted-foreground block text-[11px]">Residential Address:</span>
                    <p className="text-foreground">{selectedStaff.address || "Not provided"}</p>
                  </div>
                </div>

                {/* Work & Payroll */}
                <div className="space-y-1.5 py-2">
                  <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block">
                    Employment & Payroll
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Payee Category:</span>
                      <strong className="text-foreground">{selectedStaff.payeeVoucher}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Assigned Shift:</span>
                      <strong className="text-foreground">{selectedStaff.shiftName || "Flexible / Unassigned"}</strong>
                    </div>
                  </div>
                </div>

                {/* Spouse / Guardian Information */}
                {(selectedStaff.spouseGuardianName || selectedStaff.spouseGuardianPhone || selectedStaff.spouseGuardianAadhaar) && (
                  <div className="space-y-1.5 pt-2">
                    <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block">
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
                <Button size="sm" variant="outline" onClick={() => setIsProfileOpen(false)}>
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
