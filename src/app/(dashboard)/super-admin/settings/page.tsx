"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { Plus, Trash2, Info } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { FacultyNorms, PositionNorm, RegulatoryBody } from "@/types";

const REGULATORY_BODIES: { value: RegulatoryBody; label: string }[] = [
  { value: "UGC", label: "UGC — University Grants Commission" },
  { value: "AICTE", label: "AICTE — All India Council for Technical Education" },
  { value: "NAAC", label: "NAAC — National Assessment and Accreditation Council" },
  { value: "STATE", label: "State Regulatory Body" },
];

const QUALIFICATION_OPTIONS = [
  "B.E / B.Tech",
  "M.E / M.Tech",
  "M.Phil",
  "M.Phil / NET",
  "M.Phil / NET / Ph.D",
  "Ph.D",
  "Ph.D with NET",
  "Ph.D with 5 years experience",
  "Ph.D with 10 years experience",
];

const emptyPosition = (): PositionNorm => ({
  designation: "",
  minQualification: "Ph.D",
  minExperienceYears: 0,
  requiredPerDept: 1,
});

export default function SuperAdminSettingsPage() {
  const [norms, setNorms] = useState<FacultyNorms | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [regulatoryBody, setRegulatoryBody] = useState<RegulatoryBody>("UGC");
  const [studentFacultyRatio, setStudentFacultyRatio] = useState("15");
  const [teachingHoursPerWeek, setTeachingHoursPerWeek] = useState("16");
  const [defaultMinFacultyPerDept, setDefaultMinFacultyPerDept] = useState("3");
  const [minQualAP, setMinQualAP] = useState("M.Phil / NET / Ph.D");
  const [minQualAssocP, setMinQualAssocP] = useState("Ph.D with NET");
  const [minQualProf, setMinQualProf] = useState("Ph.D with 10 years experience");
  const [positionNorms, setPositionNorms] = useState<PositionNorm[]>([]);

  useEffect(() => {
    fetch("/api/admin/settings/faculty-norms")
      .then((r) => r.json() as Promise<{ norms: FacultyNorms }>)
      .then(({ norms: n }) => {
        setNorms(n);
        setRegulatoryBody(n.regulatoryBody);
        setStudentFacultyRatio(String(n.studentFacultyRatio));
        setTeachingHoursPerWeek(String(n.teachingHoursPerWeek));
        setDefaultMinFacultyPerDept(String(n.defaultMinFacultyPerDept));
        setMinQualAP(n.minimumQualifications.assistantProfessor);
        setMinQualAssocP(n.minimumQualifications.associateProfessor);
        setMinQualProf(n.minimumQualifications.professor);
        setPositionNorms(n.positionNorms ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load settings" }))
      .finally(() => setIsLoading(false));
  }, []);

  function updatePosition(index: number, field: keyof PositionNorm, value: string | number) {
    setPositionNorms((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  }

  function removePosition(index: number) {
    setPositionNorms((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    const sfr = Number(studentFacultyRatio);
    const thw = Number(teachingHoursPerWeek);
    const dmf = Number(defaultMinFacultyPerDept);

    if (!sfr || sfr < 1 || !thw || thw < 1 || !dmf || dmf < 1) {
      toast({ variant: "destructive", title: "All numeric fields must be positive numbers" });
      return;
    }
    if (positionNorms.some((p) => !p.designation.trim())) {
      toast({ variant: "destructive", title: "All position designations must be filled" });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/admin/settings/faculty-norms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regulatoryBody,
          studentFacultyRatio: sfr,
          teachingHoursPerWeek: thw,
          defaultMinFacultyPerDept: dmf,
          minimumQualifications: {
            assistantProfessor: minQualAP,
            associateProfessor: minQualAssocP,
            professor: minQualProf,
          },
          positionNorms,
        } satisfies Partial<FacultyNorms>),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Faculty norms saved", description: "Changes will be reflected across all vacancy requests." });
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" description="Loading..." />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Faculty Norms Configuration"
        description="Set government-mandated faculty requirements used to validate vacancy requests"
      />

      {/* Last updated banner */}
      {norms?.updatedAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border bg-muted/40 px-3 py-2">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Last updated {formatDate(norms.updatedAt)} by {norms.updatedByName ?? "Super Admin"}
        </div>
      )}

      {/* Regulatory Body */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regulatory Authority</CardTitle>
          <CardDescription>The body whose norms govern faculty requirements for your institutions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm space-y-2">
            <Label htmlFor="reg-body">Regulatory Body</Label>
            <Select value={regulatoryBody} onValueChange={(v) => setRegulatoryBody(v as RegulatoryBody)}>
              <SelectTrigger id="reg-body">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGULATORY_BODIES.map((b) => (
                  <SelectItem key={b.value} value={b.value}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Core Ratios */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Core Norms</CardTitle>
          <CardDescription>Fundamental ratios and requirements</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="sfr">Student : Faculty Ratio</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="sfr"
                  type="number"
                  min={1}
                  max={100}
                  value={studentFacultyRatio}
                  onChange={(e) => setStudentFacultyRatio(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">: 1</span>
              </div>
              <p className="text-xs text-muted-foreground">Students per faculty member</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="thw">Teaching Hours / Week</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="thw"
                  type="number"
                  min={1}
                  max={40}
                  value={teachingHoursPerWeek}
                  onChange={(e) => setTeachingHoursPerWeek(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">hrs</span>
              </div>
              <p className="text-xs text-muted-foreground">Required contact hours per week</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dmf">Min. Faculty per Department</Label>
              <Input
                id="dmf"
                type="number"
                min={1}
                max={50}
                value={defaultMinFacultyPerDept}
                onChange={(e) => setDefaultMinFacultyPerDept(e.target.value)}
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">Default minimum headcount</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Minimum Qualifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Minimum Qualifications</CardTitle>
          <CardDescription>Eligibility criteria per designation level</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(
            [
              ["Assistant Professor", minQualAP, setMinQualAP] as const,
              ["Associate Professor", minQualAssocP, setMinQualAssocP] as const,
              ["Professor", minQualProf, setMinQualProf] as const,
            ] as [string, string, (v: string) => void][]
          ).map(([label, value, setter]) => (
            <div key={label} className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
              <Label className="text-sm font-medium">{label}</Label>
              <Select value={value} onValueChange={setter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALIFICATION_OPTIONS.map((q) => (
                    <SelectItem key={q} value={q}>{q}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Position-wise Norms */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Position-wise Requirements</CardTitle>
              <CardDescription className="mt-1">Required count and qualifications per designation per department</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPositionNorms((prev) => [...prev, emptyPosition()])}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Position
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {positionNorms.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No positions configured. Click "Add Position" to define position norms.
            </p>
          ) : (
            positionNorms.map((pos, i) => (
              <div key={i} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">Position {i + 1}</Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => removePosition(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Designation *</Label>
                    <Input
                      value={pos.designation}
                      onChange={(e) => updatePosition(i, "designation", e.target.value)}
                      placeholder="e.g. Assistant Professor"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Minimum Qualification *</Label>
                    <Select
                      value={pos.minQualification}
                      onValueChange={(v) => updatePosition(i, "minQualification", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUALIFICATION_OPTIONS.map((q) => (
                          <SelectItem key={q} value={q}>{q}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Min. Experience (years)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={40}
                      value={pos.minExperienceYears}
                      onChange={(e) => updatePosition(i, "minExperienceYears", Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Required per Department</Label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={pos.requiredPerDept}
                      onChange={(e) => updatePosition(i, "requiredPerDept", Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end pb-8">
        <Button size="lg" onClick={handleSave} loading={isSaving}>
          Save Faculty Norms
        </Button>
      </div>
    </div>
  );
}
