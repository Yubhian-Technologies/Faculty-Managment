"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { formatDate, stripLeadingZeros } from "@/lib/utils";
import { Info } from "lucide-react";
import { HiringTermsSettingsCard } from "@/components/hiring/HiringTermsSettingsCard";
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

  useEffect(() => {
    Promise.all([
      fetch("/api/college/info").then((r) => r.json() as Promise<CollegeInfo>),
      fetch("/api/college/settings/general").then((r) => r.json() as Promise<{ settings: FacultyNorms }>),
    ])
      .then(([info, { settings: s }]) => {
        setCollegeInfo(info);
        setSettings(s);
        setStudentFacultyRatio(String(s.studentFacultyRatio));
        setTeachingHoursPerWeek(String(s.teachingHoursPerWeek));
        setDefaultMinFacultyPerDept(String(s.defaultMinFacultyPerDept));
        setNewJoiningYears(String(s.newJoiningYears));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load settings" }))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleSave() {
    const sfr = Number(studentFacultyRatio);
    const thw = Number(teachingHoursPerWeek);
    const dmf = Number(defaultMinFacultyPerDept);
    const njy = Number(newJoiningYears);

    if (!sfr || sfr < 1 || !thw || thw < 1 || !dmf || dmf < 1 || njy < 0) {
      toast({ variant: "destructive", title: "Please enter valid values" });
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
      <div className="max-w-2xl space-y-6">
        <PageHeader title="Settings" description="Loading..." />
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Settings" description="Basic college information and leave configuration" />

      {settings?.updatedAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border bg-muted/40 px-3 py-2">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Last updated {formatDate(settings.updatedAt)} by {settings.updatedByName ?? "Principal"}
        </div>
      )}

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Faculty Norms</CardTitle>
          <CardDescription>Core ratios used to validate vacancy requests for your college</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
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
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">: 1</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="thw">Teaching Hours / Week</Label>
            <Input
              id="thw"
              type="number"
              min={1}
              max={40}
              value={teachingHoursPerWeek}
              onChange={(e) => setTeachingHoursPerWeek(stripLeadingZeros(e.target.value))}
              className="w-24"
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
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leave Module</CardTitle>
          <CardDescription>
            A new-joining employee (Casual Leave + On Duty only) automatically converts into their vacation /
            non-vacation leave category after this many years of service.
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

      <HiringTermsSettingsCard />

      <div className="flex justify-end">
        <Button size="lg" onClick={handleSave} loading={isSaving}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}
