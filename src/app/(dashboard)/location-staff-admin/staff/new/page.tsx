"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { LocationStaffForm } from "@/components/location/LocationStaffForm";
import type { LocationDepartment, LocationShift } from "@/types/locationStaff";

export default function NewStaffMemberPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
          {isLoading ? (
            <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />
          ) : (
            <LocationStaffForm
              departments={departments}
              shifts={shifts}
              onCancel={() => router.push("/location-staff-admin/staff")}
              onSuccess={() => router.push("/location-staff-admin/staff")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
