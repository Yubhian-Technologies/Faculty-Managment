"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Edit2,
  Plus,
  Shield,
  Trash2,
  Users,
  UsersRound,
  Phone,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  CheckCircle2,
  UserCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { GoogleSearchInput } from "@/components/shared/GoogleSearchInput";
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
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      {/* ── Google Enterprise Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/90 backdrop-blur-sm p-5 sm:p-6 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-3.5">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted/80 shrink-0">
            <Link href="/location-staff-admin">
              <ArrowLeft className="h-5 w-5 text-foreground" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                Department Management
              </Badge>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {departments.length} Active {departments.length === 1 ? "Unit" : "Units"}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mt-1">
              Departments & Campus Staff Hub
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Manage non-teaching operational wings, appointed heads, shift associations, and roster directories.
            </p>
          </div>
        </div>

        <Button
          size="default"
          asChild
          className="rounded-full gap-2 h-10 text-xs font-semibold px-5 shadow-xs hover:shadow transition-all self-start sm:self-auto bg-primary text-primary-foreground hover:bg-primary/95"
        >
          <Link href="/location-staff-admin/departments/new">
            <Plus className="h-4 w-4" />
            <span>Create Department</span>
          </Link>
        </Button>
      </div>

      {/* ── Google Capsule View Switcher ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex p-1 bg-muted/60 rounded-full border border-border/50 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveView("departments")}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold transition-all duration-200 ${
              activeView === "departments"
                ? "bg-card text-foreground shadow-xs border border-border/40 font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>All Departments</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full bg-primary/10 text-primary text-[10px]">
              {departments.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView("staff-search")}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold transition-all duration-200 ${
              activeView === "staff-search"
                ? "bg-card text-foreground shadow-xs border border-border/40 font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <UsersRound className="h-3.5 w-3.5" />
            <span>Cross-Campus Staff Directory</span>
          </button>
        </div>

        {activeView === "departments" && (
          <div className="w-full sm:w-72">
            <GoogleSearchInput
              value={deptSearch}
              onChange={setDeptSearch}
              placeholder="Search departments..."
              className="w-full"
            />
          </div>
        )}
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ── VIEW 1: DEPARTMENTS LISTING ──────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {activeView === "departments" && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-48 rounded-3xl border border-border/50 bg-card/60 animate-pulse" />
              ))}
            </div>
          ) : filteredDepts.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center bg-card/40">
              <div className="h-14 w-14 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center mx-auto mb-3">
                <Building2 className="h-7 w-7 opacity-70" />
              </div>
              <h3 className="font-bold text-foreground text-base">No departments found</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                {deptSearch
                  ? `No department matches "${deptSearch}". Try a different keyword.`
                  : "Set up campus departments like Security, Housekeeping, Transport, or Facilities."}
              </p>
              <Button size="sm" asChild className="mt-4 text-xs font-semibold rounded-full px-5">
                <Link href="/location-staff-admin/departments/new">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add First Department
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDepts.map((dept) => (
                <Card
                  key={dept.id}
                  className="rounded-3xl border-border/60 shadow-xs hover:shadow-md hover:border-primary/40 transition-all duration-200 overflow-hidden flex flex-col justify-between group bg-card"
                >
                  <CardContent className="p-5 space-y-4">
                    {/* Top Row: Squircle Avatar + Title + Actions */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0 shadow-xs group-hover:scale-105 transition-transform">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/location-staff-admin/departments/${dept.id}`}
                            className="group-hover:text-primary transition-colors block"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h3 className="font-bold text-base text-foreground group-hover:text-primary truncate">
                                {dept.name}
                              </h3>
                              {dept.code && (
                                <Badge variant="outline" className="text-[10px] font-mono px-2 py-0 bg-muted/40 rounded-full">
                                  {dept.code}
                                </Badge>
                              )}
                            </div>
                          </Link>
                          {dept.description ? (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {dept.description}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground mt-0.5 italic">
                              Operational wing
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Edit Department"
                        >
                          <Link href={`/location-staff-admin/departments/${dept.id}/edit`}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeptToDelete(dept)}
                          className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Delete Department"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Department Head Capsule Cardlet */}
                    <div className="p-3 rounded-2xl bg-muted/30 border border-border/40 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Shield className="h-3 w-3 text-primary" />
                          <span>Appointed Head</span>
                        </span>
                        {dept.headUid ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Assigned
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            Unassigned
                          </span>
                        )}
                      </div>
                      {dept.headName ? (
                        <div className="pt-0.5">
                          <p className="font-semibold text-foreground text-xs">{dept.headName}</p>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5 truncate">
                            {dept.headEmail && <span className="truncate">{dept.headEmail}</span>}
                            {dept.headPhone && <span>· {dept.headPhone}</span>}
                          </p>
                        </div>
                      ) : (
                        <p className="text-muted-foreground italic text-[11px]">No department head assigned.</p>
                      )}
                    </div>

                    {/* Footer: Staff Count Badge + Open Hub Button */}
                    <div className="pt-3 border-t border-border/40 flex items-center justify-between text-xs">
                      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted/40 px-3 py-1 rounded-full border border-border/40">
                        <Users className="h-3.5 w-3.5 text-primary" />
                        <span>{dept.staffCount ?? 0} Staff</span>
                      </div>

                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs font-semibold gap-1 text-primary hover:text-primary hover:bg-primary/10 rounded-full px-3"
                      >
                        <Link href={`/location-staff-admin/departments/${dept.id}`}>
                          <span>Open Hub</span>
                          <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
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
          {/* Google Search Bar + Filter Capsule */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-card/80 backdrop-blur-sm p-3.5 sm:p-4 rounded-3xl border border-border/60 shadow-xs">
            <div className="flex-1">
              <GoogleSearchInput
                value={staffSearchQuery}
                onChange={setStaffSearchQuery}
                placeholder="Search staff by name, designation, Aadhaar, contact, voucher..."
                autoFocus
              />
            </div>

            <div className="flex items-center gap-2">
              <Select value={filterStaffDeptId} onValueChange={setFilterStaffDeptId}>
                <SelectTrigger className="h-10 text-xs w-[190px] rounded-full border-border/60 bg-muted/30 focus:bg-background">
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-40 rounded-3xl border border-border/50 bg-card/60 animate-pulse" />
              ))}
            </div>
          ) : filteredStaffAcrossDepts.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center bg-card/40">
              <div className="h-14 w-14 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center mx-auto mb-3">
                <UsersRound className="h-7 w-7 opacity-70" />
              </div>
              <h3 className="font-bold text-foreground text-base">No staff matching criteria</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Try searching by staff name, father&apos;s name, phone number, or designation.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
                <span>Showing {filteredStaffAcrossDepts.length} staff member{filteredStaffAcrossDepts.length === 1 ? "" : "s"} across campus</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredStaffAcrossDepts.map((staff) => (
                  <Card
                    key={staff.id}
                    className="rounded-3xl border-border/60 shadow-xs hover:shadow-md hover:border-primary/40 transition-all duration-200 bg-card overflow-hidden"
                  >
                    <CardContent className="p-5 space-y-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                            {staff.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-sm text-foreground truncate">{staff.name}</h3>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {staff.fatherName ? `S/o ${staff.fatherName}` : "Campus Staff"}
                            </p>
                          </div>
                        </div>

                        <Badge
                          className={`rounded-full text-[10px] font-semibold px-2.5 py-0.5 border ${
                            staff.status === "ACTIVE"
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                              : "bg-muted text-muted-foreground border-border/50"
                          }`}
                        >
                          {staff.status}
                        </Badge>
                      </div>

                      <div className="space-y-2 text-xs bg-muted/30 p-3 rounded-2xl border border-border/40">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-[11px]">Department:</span>
                          <Badge variant="outline" className="text-[10px] font-semibold bg-card px-2 py-0.5 rounded-full border-border/60">
                            <Building2 className="h-3 w-3 mr-1 text-primary" />
                            {staff.departmentName}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-[11px]">Role / Shift:</span>
                          <span className="font-medium text-foreground text-[11px] truncate max-w-[170px]">
                            {staff.role} {staff.shiftName ? `· ${staff.shiftName}` : ""}
                          </span>
                        </div>

                        <div className="flex items-center justify-between pt-1.5 border-t border-border/40 text-[11px]">
                          <span className="text-muted-foreground flex items-center gap-1.5">
                            <Phone className="h-3 w-3 text-primary" />
                            <span>{staff.contactNumber}</span>
                          </span>
                          {staff.aadhaar && (
                            <span className="font-mono text-muted-foreground text-[10px] bg-card px-1.5 py-0.5 rounded-md border border-border/40">
                              •••• {staff.aadhaar.slice(-4)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between text-xs">
                        <Button asChild size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-foreground rounded-full px-3">
                          <Link href={`/location-staff-admin/staff/${staff.id}`}>
                            View Profile
                          </Link>
                        </Button>

                        <Button asChild size="sm" variant="outline" className="h-8 text-xs font-semibold text-primary border-primary/30 hover:bg-primary/10 rounded-full px-3.5 gap-1.5">
                          <Link href={`/location-staff-admin/departments/${staff.departmentId}?tab=staff`}>
                            <span>Dept Hub</span>
                            <ArrowRight className="h-3.5 w-3.5" />
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
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Delete Department</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-muted-foreground mt-1">
              Are you sure you want to permanently delete &ldquo;{deptToDelete?.name}&rdquo;?
              This action cannot be undone. Staff members in this department will need to be reassigned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full text-xs font-semibold px-4"
              onClick={() => setDeptToDelete(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="rounded-full text-xs font-semibold px-4"
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

