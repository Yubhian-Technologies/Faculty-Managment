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
    <div className="space-y-6 max-w-xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      {/* ── Google Enterprise Header ── */}
      <div className="flex items-center gap-3.5 bg-card/90 backdrop-blur-sm p-4 sm:p-5 rounded-3xl border border-border/60 shadow-xs">
        <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted/80 shrink-0">
          <Link href={backHref}>
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Staff Member Profile</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Verified non-teaching staff personnel record.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="h-96 rounded-3xl border border-border/50 bg-card/60 animate-pulse" />
      ) : !staff ? (
        <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center bg-card/40">
          <p className="font-bold text-foreground text-base">Staff member not found</p>
          <p className="text-xs text-muted-foreground mt-1">This personnel record may have been removed or reassigned.</p>
        </div>
      ) : (
        <Card className="rounded-3xl border-border/60 shadow-xs bg-card overflow-hidden">
          <CardContent className="p-6 sm:p-7 space-y-6">
            {/* Profile Avatar & Header */}
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-2xl shadow-xs">
                {staff.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover" />
                ) : (
                  staff.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg sm:text-xl font-bold text-foreground">{staff.name}</h2>
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
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-xs font-semibold px-2.5 py-0.5 rounded-full border-primary/30 text-primary bg-primary/5">
                    {staff.role}
                  </Badge>
                  <span className="text-xs text-muted-foreground">· {staff.departmentName || "Unassigned"}</span>
                  {isHead && (
                    <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      <span>Department Head</span>
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-2 text-xs divide-y divide-border/40">
              {/* Department & Supervision */}
              <div className="space-y-2 pt-2">
                <span className="font-bold text-muted-foreground uppercase text-[10px] tracking-wider block">
                  Department & Supervision
                </span>
                <div className="grid grid-cols-2 gap-3 bg-muted/30 p-3.5 rounded-2xl border border-border/40">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Department:</span>
                    <strong className="text-foreground text-xs">{staff.departmentName || "Unassigned"}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Supervising Head:</span>
                    <strong className="text-foreground text-xs">{department?.headName || "Unassigned"}</strong>
                  </div>
                </div>
              </div>

              {/* Personal Information */}
              <div className="space-y-2 pt-4">
                <span className="font-bold text-muted-foreground uppercase text-[10px] tracking-wider block">
                  Personal Information
                </span>
                <div className="grid grid-cols-2 gap-3 bg-muted/30 p-3.5 rounded-2xl border border-border/40">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Father&rsquo;s Name:</span>
                    <strong className="text-foreground text-xs">{staff.fatherName || "—"}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Contact Number:</span>
                    <strong className="text-foreground text-xs">{staff.contactNumber}</strong>
                  </div>
                  <div className="col-span-2 pt-2 border-t border-border/30">
                    <span className="text-muted-foreground block text-[11px]">Aadhaar Number:</span>
                    <strong className="font-mono text-foreground text-sm tracking-wider">{staff.aadhaar}</strong>
                  </div>
                  <div className="col-span-2 pt-2 border-t border-border/30">
                    <span className="text-muted-foreground block text-[11px]">Residential Address:</span>
                    <p className="text-foreground text-xs">{staff.address || "Not provided"}</p>
                  </div>
                </div>
              </div>

              {/* Work & Payroll */}
              <div className="space-y-2 pt-4">
                <span className="font-bold text-muted-foreground uppercase text-[10px] tracking-wider block">
                  Employment & Payroll
                </span>
                <div className="grid grid-cols-2 gap-3 bg-muted/30 p-3.5 rounded-2xl border border-border/40">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Payee Category:</span>
                    <strong className="text-foreground text-xs">{staff.payeeVoucher}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Assigned Shift:</span>
                    <strong className="text-foreground text-xs">{staff.shiftName || "Flexible / Unassigned"}</strong>
                  </div>
                </div>
              </div>

              {/* Spouse / Guardian Information */}
              {(staff.spouseGuardianName || staff.spouseGuardianPhone || staff.spouseGuardianAadhaar) && (
                <div className="space-y-2 pt-4">
                  <span className="font-bold text-muted-foreground uppercase text-[10px] tracking-wider block">
                    Spouse / Guardian Information
                  </span>
                  <div className="grid grid-cols-2 gap-3 bg-muted/30 p-3.5 rounded-2xl border border-border/40">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Name:</span>
                      <strong className="text-foreground text-xs">{staff.spouseGuardianName || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Phone:</span>
                      <strong className="text-foreground text-xs">{staff.spouseGuardianPhone || "—"}</strong>
                    </div>
                    {staff.spouseGuardianAadhaar && (
                      <div className="col-span-2 pt-2 border-t border-border/30">
                        <span className="text-muted-foreground block text-[11px]">Aadhaar:</span>
                        <strong className="font-mono text-foreground text-xs">{staff.spouseGuardianAadhaar}</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

