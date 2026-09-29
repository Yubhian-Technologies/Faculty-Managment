"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { LocationStaffForm } from "@/components/location/LocationStaffForm";
import type { LocationShift } from "@/types/locationStaff";

export default function NewDeptStaffMemberPage() {
  const router = useRouter();
  const { activeDept, activeDeptId } = useActiveLocationDept();
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    if (!activeDeptId) return;
    fetch(`/api/location/shifts?departmentId=${activeDeptId}`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
      .then((d) => {
        if (!isCancelled) setShifts(d.shifts ?? []);
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load shifts" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [activeDeptId]);

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 bg-card p-4 rounded-xl border shadow-xs">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
          <Link href="/location-dept-head/staff">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            <span>Add Staff Member</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Register a new employee for {activeDept?.name ?? "your department"}.
          </p>
        </div>
      </div>

      <Card className="border shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Staff Registration Form</CardTitle>
          <CardDescription className="text-xs">
            Fields marked with an asterisk (<span className="text-destructive font-bold">*</span>) are mandatory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !activeDeptId ? (
            <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />
          ) : (
            <LocationStaffForm
              departments={[]}
              shifts={shifts}
              lockedDepartmentId={activeDeptId}
              lockedDepartmentName={activeDept?.name}
              onCancel={() => router.push("/location-dept-head/staff")}
              onSuccess={() => router.push("/location-dept-head/staff")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
