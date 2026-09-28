"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Edit2,
  Plus,
  Search,
  Shield,
  Trash2,
  Users,
  UsersRound,
  Clock,
  Phone,
  ArrowRight,
  ExternalLink,
  Filter,
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment, LocationStaffMember } from "@/types/locationStaff";

export default function LocationDepartmentsPage() {
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeView, setActiveView] = useState<"departments" | "staff-search">("departments");

  // Department search
  const [deptSearch, setDeptSearch] = useState("");

  // Staff cross-department search state
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [staffSearchQuery, setStaffSearchQuery] = useState("");
  const [filterStaffDeptId, setFilterStaffDeptId] = useState("ALL");

  // Delete confirmation state
  const [deptToDelete, setDeptToDelete] = useState<LocationDepartment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load departments
  useEffect(() => {
    let isCancelled = false;
    fetch(`/api/location/departments`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
      .then((d) => {
        if (!isCancelled) setDepartments(d.departments ?? []);
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load departments" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [refreshKey]);

  // Load all staff across departments when switching to staff search or when needed
  useEffect(() => {
    if (activeView === "staff-search" && staffList.length === 0) {
      setIsLoadingStaff(true);
      fetch(`/api/location/staff?status=ALL`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => {
          setStaffList(d.staff ?? []);
        })
        .catch(() => {})
        .finally(() => setIsLoadingStaff(false));
    }
  }, [activeView, staffList.length]);

  const handleDeleteDepartment = async () => {
    if (!deptToDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/location/departments/${deptToDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete department");

      toast({
        title: "Department Deleted",
        description: `"${deptToDelete.name}" has been removed.`,
      });
      setDeptToDelete(null);
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast({ variant: "destructive", title: "Delete Failed", description: msg });
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredDepts = useMemo(() => {
    const term = deptSearch.toLowerCase().trim();
    if (!term) return departments;
    return departments.filter(
      (d) =>
        d.name.toLowerCase().includes(term) ||
        d.code?.toLowerCase().includes(term) ||
        d.headName?.toLowerCase().includes(term)
    );
  }, [departments, deptSearch]);

  const filteredStaffAcrossDepts = useMemo(() => {
    const term = staffSearchQuery.toLowerCase().trim();
    return staffList.filter((s) => {
      const matchSearch =
        !term ||
        s.name.toLowerCase().includes(term) ||
        s.fatherName?.toLowerCase().includes(term) ||
        s.role.toLowerCase().includes(term) ||
        s.departmentName.toLowerCase().includes(term) ||
        s.contactNumber.includes(term) ||
        s.aadhaar.includes(term) ||
        s.payeeVoucher?.toLowerCase().includes(term);

      const matchDept = filterStaffDeptId === "ALL" || s.departmentId === filterStaffDeptId;

      return matchSearch && matchDept;
    });
  }, [staffList, staffSearchQuery, filterStaffDeptId]);

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-staff-admin">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <Badge variant="outline" className="text-primary border-primary/30 text-[10px] font-semibold px-1.5 py-0 mb-1">
              Location Staff Admin
            </Badge>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Location Departments & Staff Hub</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select a department to view its Head, Staff, Shifts, and Attendance Reports.
            </p>
          </div>
        </div>

        <Button
          size="sm"
          asChild
          className="rounded-full gap-1.5 h-9 text-xs font-semibold px-4 shadow-sm self-start sm:self-auto"
        >
          <Link href="/location-staff-admin/departments/new">
            <Plus className="h-4 w-4" />
            <span>New Department</span>
          </Link>
        </Button>
      </div>

      {/* ── View Switcher (All Departments vs Search Staff Across Departments) ── */}
      <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-xl border border-border/80">
        <button
          type="button"
          onClick={() => setActiveView("departments")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "departments"
              ? "bg-card text-foreground shadow-xs border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>All Departments ({departments.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveView("staff-search")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "staff-search"
              ? "bg-card text-foreground shadow-xs border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Search className="h-4 w-4" />
          <span>Search Staff Across Campus</span>
        </button>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ── VIEW 1: DEPARTMENTS LISTING ──────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {activeView === "departments" && (
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by department name, code, or department head..."
              value={deptSearch}
              onChange={(e) => setDeptSearch(e.target.value)}
              className="pl-9 h-9 text-xs rounded-xl bg-card"
            />
          </div>

          {/* Departments Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-44 rounded-xl border bg-card/60 animate-pulse" />
              ))}
            </div>
          ) : filteredDepts.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
              <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="font-semibold text-foreground text-sm">No departments found</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {deptSearch ? "No department matches your search term." : "Create departments such as Security, Housekeeping, Transport, or Catering."}
              </p>
              <Button size="sm" asChild variant="outline" className="mt-3 text-xs rounded-full">
                <Link href="/location-staff-admin/departments/new">
                  Create First Department
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredDepts.map((dept) => (
                <Card
                  key={dept.id}
                  className="border-border/80 shadow-xs flex flex-col justify-between hover:border-primary/50 hover:shadow-sm transition-all group"
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/location-staff-admin/departments/${dept.id}`}
                          className="group-hover:text-primary transition-colors block"
                        >
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-base text-foreground group-hover:text-primary truncate">
                              {dept.name}
                            </h3>
                            {dept.code && (
                              <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                                {dept.code}
                              </Badge>
                            )}
                          </div>
                        </Link>
                        {dept.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {dept.description}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          title="Edit Department"
                        >
                          <Link href={`/location-staff-admin/departments/${dept.id}/edit`}>
                            <Edit2 className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeptToDelete(dept)}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Delete Department"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    {/* Assigned Department Head Cardlet */}
                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                          <Shield className="h-3 w-3 text-primary" />
                          <span>Department Head</span>
                        </span>
                        {dept.headUid ? (
                          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] px-1.5 py-0">
                            Assigned
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0">
                            Unassigned
                          </Badge>
                        )}
                      </div>
                      {dept.headName ? (
                        <div>
                          <p className="font-bold text-foreground">{dept.headName}</p>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                            {dept.headEmail && <span>{dept.headEmail}</span>}
                            {dept.headPhone && <span>· {dept.headPhone}</span>}
                          </p>
                        </div>
                      ) : (
                        <p className="text-muted-foreground italic text-[11px]">No head assigned yet.</p>
                      )}
                    </div>

                    {/* Bottom stats & Direct Link to Department Hub */}
                    <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs">
                      <span className="font-medium text-muted-foreground flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        <span>{dept.staffCount ?? 0} Staff</span>
                      </span>

                      <Button
                        asChild
                        size="sm"
                        className="h-7 text-xs font-semibold gap-1 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all rounded-lg px-2.5"
                      >
                        <Link href={`/location-staff-admin/departments/${dept.id}`}>
                          <span>Open Dept</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ── VIEW 2: SEARCH STAFF ACROSS ALL DEPARTMENTS ──────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {activeView === "staff-search" && (
        <div className="space-y-4">
          {/* Search bar & Department filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 bg-card p-3 rounded-xl border">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search staff across all departments by name, role, contact, Aadhaar, voucher..."
                value={staffSearchQuery}
                onChange={(e) => setStaffSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs rounded-xl"
                autoFocus
              />
            </div>

            <div className="flex items-center gap-2">
              <Select value={filterStaffDeptId} onValueChange={setFilterStaffDeptId}>
                <SelectTrigger className="h-9 text-xs w-[180px] rounded-xl">
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Results list */}
          {isLoadingStaff ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-36 rounded-xl border bg-card/60 animate-pulse" />
              ))}
            </div>
          ) : filteredStaffAcrossDepts.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
              <UsersRound className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="font-semibold text-foreground text-sm">No staff matching search</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Try searching by staff name, father&apos;s name, phone number, or designation.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground px-1">
                Showing {filteredStaffAcrossDepts.length} staff member{filteredStaffAcrossDepts.length === 1 ? "" : "s"} across campus:
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredStaffAcrossDepts.map((staff) => (
                  <Card key={staff.id} className="border-border/80 shadow-xs hover:border-primary/40 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                            {staff.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-sm text-foreground truncate">{staff.name}</h3>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {staff.fatherName ? `S/o ${staff.fatherName}` : "Staff Member"}
                            </p>
                          </div>
                        </div>

                        <Badge
                          className={
                            staff.status === "ACTIVE"
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-1.5 py-0"
                              : "bg-muted text-muted-foreground text-[10px] px-1.5 py-0"
                          }
                        >
                          {staff.status}
                        </Badge>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-[11px]">Department:</span>
                          <Badge variant="outline" className="text-[10px] font-semibold bg-muted/40 px-1.5 py-0">
                            <Building2 className="h-3 w-3 mr-1 text-primary" />
                            {staff.departmentName}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-[11px]">Role / Shift:</span>
                          <span className="font-medium text-foreground text-[11px]">
                            {staff.role} {staff.shiftName ? `· ${staff.shiftName}` : ""}
                          </span>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px]">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <span>{staff.contactNumber}</span>
                          </span>
                          {staff.aadhaar && (
                            <span className="font-mono text-muted-foreground">
                              •••• {staff.aadhaar.slice(-4)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs">
                        <Button asChild size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground px-2">
                          <Link href={`/location-staff-admin/staff/${staff.id}`}>
                            Profile
                          </Link>
                        </Button>

                        <Button asChild size="sm" variant="outline" className="h-7 text-xs text-primary px-2.5 rounded-lg gap-1">
                          <Link href={`/location-staff-admin/departments/${staff.departmentId}?tab=staff`}>
                            <span>Dept Hub</span>
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={!!deptToDelete} onOpenChange={(open) => !open && setDeptToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Department</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete &ldquo;{deptToDelete?.name}&rdquo;?
              This action cannot be undone. Staff members in this department will need to be reassigned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeptToDelete(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteDepartment}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Department"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
