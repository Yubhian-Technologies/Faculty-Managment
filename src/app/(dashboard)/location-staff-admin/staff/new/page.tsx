"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { LocationStaffForm } from "@/components/location/LocationStaffForm";
import type { LocationDepartment, LocationShift } from "@/types/locationStaff";

export default function NewStaffMemberPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetDeptId = searchParams.get("departmentId") || "";

  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fallbackHref = targetDeptId
    ? `/location-staff-admin/departments/${targetDeptId}?tab=staff`
    : "/location-staff-admin/departments";

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      fetch(`/api/location/departments`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
        .then((d) => {
          if (!isCancelled) setDepartments(d.departments ?? []);
        }),
      fetch(`/api/location/shifts${targetDeptId ? `?departmentId=${targetDeptId}` : ""}`)
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
  }, [targetDeptId]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      {/* ── Google Enterprise Header ── */}
      <div className="flex items-center justify-between gap-4 bg-card/90 backdrop-blur-sm p-5 sm:p-6 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-3.5">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted/80 shrink-0">
            <Link href={fallbackHref}>
              <ArrowLeft className="h-5 w-5 text-foreground" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                Staff Onboarding
              </Badge>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <span>Register New Staff Member</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Register non-teaching campus staff. Registered members can also be appointed as Department Heads.
            </p>
          </div>
        </div>
      </div>

      <Card className="rounded-3xl border-border/60 shadow-xs bg-card overflow-hidden">
        <CardHeader className="p-6 pb-4 border-b border-border/40">
          <CardTitle className="text-base font-bold text-foreground">Staff Profile Details</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Fields marked with an asterisk (<span className="text-destructive font-bold">*</span>) are mandatory. Real-time photo capture and file upload supported.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {isLoading ? (
            <div className="h-72 rounded-2xl border border-border/50 bg-muted/20 animate-pulse" />
          ) : (
            <LocationStaffForm
              departments={departments}
              shifts={shifts}
              lockedDepartmentId={targetDeptId || undefined}
              onCancel={() => router.push(fallbackHref)}
              onSuccess={(created) =>
                router.push(
                  created.departmentId
                    ? `/location-staff-admin/departments/${created.departmentId}?tab=staff`
                    : fallbackHref
                )
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

