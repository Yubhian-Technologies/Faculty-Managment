"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { formatDate, stripLeadingZeros } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight, Info, Clock } from "lucide-react";
import { HiringTermsSettingsCard } from "@/components/hiring/HiringTermsSettingsCard";
import { AcademicYearSettingsCard } from "@/components/academics/AcademicYearSettingsCard";
import { FinancialYearSettingsCard } from "@/components/academics/FinancialYearSettingsCard";
import { DesignationCatalogCard } from "@/components/academics/DesignationCatalogCard";
import { HonorificsCatalogCard } from "@/components/academics/HonorificsCatalogCard";
import { LeaveApprovalRoutingCard } from "@/components/leave/LeaveApprovalRoutingCard";
import { LeaveVacationStaffCard } from "@/components/leave/LeaveVacationStaffCard";
import { LeaveTypeRulesCard } from "@/components/leave/LeaveTypeRulesCard";
import { AttendanceNotPostedSettingsCard } from "@/components/attendance/AttendanceNotPostedSettingsCard";
import type { FacultyNorms } from "@/types/core";

interface CollegeInfo {
  name: string;
  phone: string;
  email: string;
  address: string;
}

export default function PrincipalSettingsPage() {
  const [collegeInfo, setCollegeInfo] = useState<CollegeInfo | null>(null);
  const [settings, setSettings] = useState<FacultyNorms | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [studentFacultyRatio, setStudentFacultyRatio] = useState("15");
  const [teachingHoursPerWeek, setTeachingHoursPerWeek] = useState("16");
  const [defaultMinFacultyPerDept, setDefaultMinFacultyPerDept] = useState("3");
  const [newJoiningYears, setNewJoiningYears] = useState("1");
  const [maxTheoryPeriodsPerWeek, setMaxTheoryPeriodsPerWeek] = useState("4");
  const [maxPracticalPeriodsPerWeek, setMaxPracticalPeriodsPerWeek] = useState("6");
  const [theoryBlockSize, setTheoryBlockSize] = useState("1");
  const [labBlockSize, setLabBlockSize] = useState("3");

  useEffect(() => {
    Promise.all([
      fetch("/api/college/info").then((r) => r.json() as Promise<CollegeInfo>),
      fetch("/api/college/settings/general").then((r) => r.json() as Promise<{ settings: FacultyNorms }>),
    ])
      .then(([info, { settings: s }]) => {
        setCollegeInfo(info);
        setSettings(s);
        setStudentFacultyRatio(String(s.studentFacultyRatio ?? 15));
        setTeachingHoursPerWeek(String(s.teachingHoursPerWeek ?? 16));
        setDefaultMinFacultyPerDept(String(s.defaultMinFacultyPerDept ?? 3));
        setNewJoiningYears(String(s.newJoiningYears ?? 1));
        setMaxTheoryPeriodsPerWeek(String(s.maxTheoryPeriodsPerWeek ?? 4));
        setMaxPracticalPeriodsPerWeek(String(s.maxPracticalPeriodsPerWeek ?? 6));
        setTheoryBlockSize(String(s.theoryBlockSize ?? 1));
        setLabBlockSize(String(s.labBlockSize ?? 3));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load settings" }))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleSave() {
    const sfr = Number(studentFacultyRatio);
    const thw = Number(teachingHoursPerWeek);
    const dmf = Number(defaultMinFacultyPerDept);
    const njy = Number(newJoiningYears);
    const mtp = Number(maxTheoryPeriodsPerWeek);
    const mpp = Number(maxPracticalPeriodsPerWeek);
    const tbs = Number(theoryBlockSize);
    const lbs = Number(labBlockSize);

    if (
      !sfr || sfr < 1 ||
      !thw || thw < 1 ||
      !dmf || dmf < 1 ||
      njy < 0 ||
      !mtp || mtp < 1 ||
      !mpp || mpp < 1 ||
      !tbs || tbs < 1 ||
      !lbs || lbs < 1
    ) {
      toast({ variant: "destructive", title: "Please enter valid numeric settings" });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/college/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentFacultyRatio: sfr,
          teachingHoursPerWeek: thw,
          defaultMinFacultyPerDept: dmf,
          newJoiningYears: njy,
          maxTheoryPeriodsPerWeek: mtp,
          maxPracticalPeriodsPerWeek: mpp,
          theoryBlockSize: tbs,
          labBlockSize: lbs,
        } satisfies Partial<FacultyNorms>),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Settings saved" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-6xl space-y-6">
        <PageHeader title="Settings" description="Loading settings..." />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Settings" description="College configuration, period rules, and module settings" />

      {settings?.updatedAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border bg-muted/40 px-3 py-2">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Last updated {formatDate(settings.updatedAt)} by {settings.updatedByName ?? "Principal"}
        </div>
      )}

      {/* Single Column Layout */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">College Information</CardTitle>
          <CardDescription>Managed by Super Admin - shown here for reference</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Name</p>
            <p className="text-sm font-medium">{collegeInfo?.name || "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Contact Email</p>
            <p className="text-sm font-medium">{collegeInfo?.email || "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Contact Phone</p>
            <p className="text-sm font-medium">{collegeInfo?.phone || "-"}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground">Address</p>
            <p className="text-sm font-medium">{collegeInfo?.address || "-"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Timetable Period Rules & Continuous Slot Allocation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Timetable Period Rules & Continuous Slots
          </CardTitle>
          <CardDescription>
            Set weekly limits and continuous slot allocation (block sizes) for Theory and Practical subjects. When placing a subject on the timetable grid, Theory and Practical automatically allocate these continuous periods (e.g. Lab: 3 continuous slots). Other subject types (Tutorial, Seminar, Project, etc.) are unrestricted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mtp">Theory Max / Week</Label>
              <Input
                id="mtp"
                type="number"
                min={1}
                max={40}
                value={maxTheoryPeriodsPerWeek}
                onChange={(e) => setMaxTheoryPeriodsPerWeek(stripLeadingZeros(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mpp">Practical Max / Week</Label>
              <Input
                id="mpp"
                type="number"
                min={1}
                max={40}
                value={maxPracticalPeriodsPerWeek}
                onChange={(e) => setMaxPracticalPeriodsPerWeek(stripLeadingZeros(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t">
            <div className="space-y-2">
              <Label htmlFor="tbs">Theory Continuous Slots</Label>
              <Input
                id="tbs"
                type="number"
                min={1}
                max={10}
                value={theoryBlockSize}
                onChange={(e) => setTheoryBlockSize(stripLeadingZeros(e.target.value))}
              />
              <p className="text-[11px] text-muted-foreground">Default: 1 period</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lbs">Practical / Lab Continuous Slots</Label>
              <Input
                id="lbs"
                type="number"
                min={1}
                max={10}
                value={labBlockSize}
                onChange={(e) => setLabBlockSize(stripLeadingZeros(e.target.value))}
              />
              <p className="text-[11px] text-muted-foreground">Default: 3 continuous periods</p>
            </div>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Rule:</span> When placing a subject on the timetable grid, <strong>THEORY</strong> allocates {theoryBlockSize || 1} slot(s) and <strong>PRACTICAL / LAB</strong> allocates {labBlockSize || 3} continuous slot(s). Other subject types remain unrestricted (1 slot).
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Faculty Norms</CardTitle>
          <CardDescription>Core ratios used to validate vacancy requests for your college</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="sfr">Student : Faculty Ratio</Label>
            <div className="flex items-center gap-2">
              <Input
                id="sfr"
                type="number"
                min={1}
                max={100}
                value={studentFacultyRatio}
                onChange={(e) => setStudentFacultyRatio(stripLeadingZeros(e.target.value))}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">: 1</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="thw">Teaching Hours / Wk</Label>
            <Input
              id="thw"
              type="number"
              min={1}
              max={40}
              value={teachingHoursPerWeek}
              onChange={(e) => setTeachingHoursPerWeek(stripLeadingZeros(e.target.value))}
              className="w-20"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dmf">Min. Faculty / Dept</Label>
            <Input
              id="dmf"
              type="number"
              min={1}
              max={50}
              value={defaultMinFacultyPerDept}
              onChange={(e) => setDefaultMinFacultyPerDept(stripLeadingZeros(e.target.value))}
              className="w-20"
            />
          </div>
        </CardContent>
      </Card>

      <AcademicYearSettingsCard />
      <FinancialYearSettingsCard />
      <AttendanceNotPostedSettingsCard />
      <HiringTermsSettingsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Student Permissions</CardTitle>
          <CardDescription>Who approves permission requests, per department and type</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/principal/student-permissions">Open routing and requests <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leave Module</CardTitle>
          <CardDescription>
            A new-joining employee automatically converts into their vacation / non-vacation leave category after this many years of service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="njy">New Joining Period (years)</Label>
            <Input
              id="njy"
              type="number"
              min={0}
              max={10}
              value={newJoiningYears}
              onChange={(e) => setNewJoiningYears(stripLeadingZeros(e.target.value))}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      <LeaveApprovalRoutingCard />
      <LeaveVacationStaffCard />
      <LeaveTypeRulesCard />
      <DesignationCatalogCard category="FACULTY" />
      <DesignationCatalogCard category="TECHNICAL" />
      <DesignationCatalogCard category="NON_TECHNICAL" />
      <HonorificsCatalogCard />

      <div className="flex justify-end pt-4 border-t">
        <Button size="lg" onClick={handleSave} loading={isSaving}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}
