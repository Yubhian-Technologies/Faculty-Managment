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
import { subjectBlockKey } from "@/lib/timetable/subjectBlockSize";

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

  // Per-subject overrides: key -> slots, plus the subject catalog for the search picker.
  const [subjectSlots, setSubjectSlots] = useState<Record<string, number>>({});
  const [subjectOptions, setSubjectOptions] = useState<Record<string, string>>({}); // key -> label
  const [subjectQuery, setSubjectQuery] = useState("");
  const [subjectPickerOpen, setSubjectPickerOpen] = useState(false);

  const [depts, setDepts] = useState<{ id: string; name: string; parentDepartmentId?: string }[]>([]);
  const [subjectDepts, setSubjectDepts] = useState<Record<string, string[]>>({}); // key -> department ids
  // Picking a department shows its subjects straight away: focusing the search
  // box opens the list, and its blur handler closes it again.
  const openSubjectList = () => document.getElementById("subj-search")?.focus();
  const [deptFilter, setDeptFilter] = useState("");
  const [subDeptFilter, setSubDeptFilter] = useState("");

  useEffect(() => {
    // Each lookup fails on its own - a dept/course error must not empty the subject search.
    const json = <T,>(url: string) =>
      fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<T>) : ({} as T)))
        .catch(() => ({} as T));
    Promise.all([
      json<{ subjects?: { name?: string; code?: string; courseId?: string; department?: string; departmentId?: string }[] }>("/api/college/subjects"),
      json<{ departments?: { id: string; name: string; parentDepartmentId?: string }[] }>("/api/college/departments"),
      json<{ courses?: { id: string; departmentId: string; mergedCourseIds?: string[] }[] }>("/api/college/courses"),
    ])
      .then(async ([{ subjects }, { departments }, { courses }]) => {
        // A sub-department's subjects hang off its PARENT's course, so only the
        // semester assignments (which carry the real departmentId) can tell them apart.
        const courseIds = Array.from(new Set((courses ?? []).flatMap((c) => [c.id, ...(c.mergedCourseIds ?? [])])));
        const assigned = await Promise.all(
          courseIds.map((id) =>
            json<{ assignments?: { subjectCode?: string; subjectName?: string; departmentId?: string }[] }>(
              `/api/college/subject-semester-assignments?courseId=${encodeURIComponent(id)}`,
            ),
          ),
        );
        const deptList = departments ?? [];
        const courseDept = new Map<string, string>();
        for (const c of courses ?? []) for (const id of [c.id, ...(c.mergedCourseIds ?? [])]) courseDept.set(id, c.departmentId);
        const deptByName = new Map(deptList.map((d) => [d.name, d.id]));
        const opts: Record<string, string> = {};
        const sd: Record<string, string[]> = {};
        for (const s of subjects ?? []) {
          const key = subjectBlockKey(s);
          if (!key) continue;
          if (!opts[key]) opts[key] = s.code ? `${s.name ?? s.code} (${s.code})` : (s.name ?? key);
          const d = s.departmentId ?? (s.courseId ? courseDept.get(s.courseId) : undefined) ?? (s.department ? deptByName.get(s.department) : undefined);
          if (d) (sd[key] ??= []).includes(d) || sd[key].push(d);
        }
        for (const { assignments } of assigned) {
          for (const a of assignments ?? []) {
            const key = subjectBlockKey({ code: a.subjectCode, name: a.subjectName });
            if (key && a.departmentId && !(sd[key] ??= []).includes(a.departmentId)) sd[key].push(a.departmentId);
          }
        }
        setDepts(deptList);
        setSubjectDepts(sd);
        setSubjectOptions(opts);
      })
      .catch(() => undefined); // picker just stays empty
  }, []);

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
        setSubjectSlots(s.subjectBlockSizes ?? {});
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

    if (
      !sfr || sfr < 1 ||
      !thw || thw < 1 ||
      !dmf || dmf < 1 ||
      njy < 0 ||
      !mtp || mtp < 1 ||
      !mpp || mpp < 1
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
          subjectBlockSizes: subjectSlots,
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

          <div className="space-y-2 pt-2 border-t">
            <Label htmlFor="subj-search">Custom continuous slots for a specific subject</Label>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="Filter by department"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={deptFilter}
                onChange={(e) => { setDeptFilter(e.target.value); setSubDeptFilter(""); openSubjectList(); }}
              >
                <option value="">All departments</option>
                {depts.filter((d) => !d.parentDepartmentId).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select
                aria-label="Filter by sub-department"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={subDeptFilter}
                disabled={!deptFilter}
                onChange={(e) => { setSubDeptFilter(e.target.value); openSubjectList(); }}
              >
                <option value="">All sub-departments</option>
                {depts.filter((d) => d.parentDepartmentId === deptFilter).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Input
                id="subj-search"
                placeholder="Search subject by name or code..."
                autoComplete="off"
                value={subjectQuery}
                onChange={(e) => { setSubjectQuery(e.target.value); setSubjectPickerOpen(true); }}
                onFocus={() => setSubjectPickerOpen(true)}
                onBlur={() => setTimeout(() => setSubjectPickerOpen(false), 150)}
              />
              {subjectPickerOpen && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
                  {Object.keys(subjectOptions).length === 0 && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No subjects loaded</li>
                  )}
                  {Object.entries(subjectOptions)
                    .filter(([k, label]) => {
                      if (k in subjectSlots || !label.toLowerCase().includes(subjectQuery.trim().toLowerCase())) return false;
                      if (!deptFilter) return true;
                      // Department alone = itself + its sub-departments; a sub-department = just that one.
                      const allowed = subDeptFilter
                        ? [subDeptFilter]
                        : [deptFilter, ...depts.filter((d) => d.parentDepartmentId === deptFilter).map((d) => d.id)];
                      return (subjectDepts[k] ?? []).some((d) => allowed.includes(d));
                    })
                    .slice(0, 50)
                    .map(([k, label]) => (
                      <li key={k}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSubjectSlots((p) => ({ ...p, [k]: 2 }));
                            setSubjectQuery("");
                            setSubjectPickerOpen(false);
                          }}
                        >
                          {label}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            {Object.entries(subjectSlots).map(([k, n]) => (
              <div key={k} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <span className="flex-1 text-sm">{subjectOptions[k] ?? k}</span>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  className="w-20"
                  value={n}
                  onChange={(e) => setSubjectSlots((p) => ({ ...p, [k]: Number(e.target.value) }))}
                />
                <span className="text-xs text-muted-foreground">slots</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSubjectSlots((p) => Object.fromEntries(Object.entries(p).filter(([x]) => x !== k)))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">Overrides the Theory / Practical value above for that subject only. Save to apply.</p>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Rule:</span> A subject takes 1 slot when placed on the timetable grid, unless you set custom continuous slots for it above.
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
