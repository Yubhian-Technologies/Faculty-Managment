"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment, LocationStaffMember } from "@/types/locationStaff";

interface LocationStaffProfileViewProps {
  staffId: string;
  backHref: string;
}

// Shared read-only staff profile page content - the single view both Location
// Staff Admin (location-staff-admin/staff/[id]) and Location Dept Head
// (location-dept-head/staff/[id]) render, instead of each keeping its own copy
// of the same fields in a dialog.
export function LocationStaffProfileView({ staffId, backHref }: LocationStaffProfileViewProps) {
  const [staff, setStaff] = useState<LocationStaffMember | null>(null);
  const [department, setDepartment] = useState<LocationDepartment | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      fetch(`/api/location/staff/${staffId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => (d.staff as LocationStaffMember | undefined) ?? null),
      fetch(`/api/location/departments`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
        .then((d) => (d.departments as LocationDepartment[] | undefined) ?? []),
    ])
      .then(([staffData, departments]) => {
        if (isCancelled) return;
        setStaff(staffData);
        setDepartment(departments.find((dep) => dep.id === staffData?.departmentId) ?? null);
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load staff profile" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [staffId]);

  const isHead = !!staff?.isDeptHead;

  return (
    <div className="space-y-4 max-w-lg mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 bg-card p-3 sm:p-4 rounded-xl border">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
          <Link href={backHref}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground">Staff Profile</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Full details for this staff member.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="h-96 rounded-xl border bg-card/60 animate-pulse" />
      ) : !staff ? (
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <p className="font-semibold text-foreground text-sm">Staff member not found</p>
        </div>
      ) : (
        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-xl">
                {staff.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover" />
                ) : (
                  staff.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground">{staff.name}</h2>
                  {staff.status === "ACTIVE" ? (
                    <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0">Active</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inactive</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                    {staff.role}
                  </Badge>
                  <span className="text-xs text-muted-foreground">· {staff.departmentName || "Unassigned"}</span>
                  {isHead && (
                    <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] px-1.5 py-0 flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      <span>Department Head</span>
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-1 text-xs divide-y divide-border/50">
              {/* Department & Supervision */}
              <div className="space-y-1.5 pb-2">
                <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block">
                  Department & Supervision
                </span>
                <div className="grid grid-cols-2 gap-2 bg-muted/30 p-2.5 rounded-lg border border-border/50">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Department:</span>
                    <strong className="text-foreground">{staff.departmentName || "Unassigned"}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Supervising Head:</span>
                    <strong className="text-foreground">{department?.headName || "Unassigned"}</strong>
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
                    <strong className="text-foreground">{staff.fatherName || "—"}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Contact Number:</span>
                    <strong className="text-foreground">{staff.contactNumber}</strong>
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-muted-foreground block text-[11px]">Aadhaar Number:</span>
                  <strong className="font-mono text-foreground text-sm tracking-wider">{staff.aadhaar}</strong>
                </div>
                <div className="mt-2">
                  <span className="text-muted-foreground block text-[11px]">Residential Address:</span>
                  <p className="text-foreground">{staff.address || "Not provided"}</p>
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
                    <strong className="text-foreground">{staff.payeeVoucher}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Assigned Shift:</span>
                    <strong className="text-foreground">{staff.shiftName || "Flexible / Unassigned"}</strong>
                  </div>
                </div>
              </div>

              {/* Spouse / Guardian Information */}
              {(staff.spouseGuardianName || staff.spouseGuardianPhone || staff.spouseGuardianAadhaar) && (
                <div className="space-y-1.5 pt-2">
                  <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider block">
                    Spouse / Guardian Information
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Name:</span>
                      <strong className="text-foreground">{staff.spouseGuardianName || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Phone:</span>
                      <strong className="text-foreground">{staff.spouseGuardianPhone || "—"}</strong>
                    </div>
                  </div>
                  {staff.spouseGuardianAadhaar && (
                    <div className="mt-1">
                      <span className="text-muted-foreground block text-[11px]">Aadhaar:</span>
                      <strong className="font-mono text-foreground">{staff.spouseGuardianAadhaar}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
