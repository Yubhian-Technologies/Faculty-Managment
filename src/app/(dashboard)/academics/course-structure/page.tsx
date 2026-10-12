"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { CourseStructureStep } from "@/components/academics/CourseStructureStep";
import { SubjectsStep } from "@/components/academics/SubjectsStep";
import { SyllabusStep } from "@/components/academics/SyllabusStep";
import { RegulationDocStep } from "@/components/academics/RegulationDocStep";
import { AlertTriangle } from "lucide-react";

// Curriculum: one scope (Regulation -> Course -> Department), picked once in
// the bar below, shared by every step - instead of the old 4 separate pages
// (Regulation, Course Structure, Subjects, Syllabus) each asking for it from
// scratch. The URL/route stays /academics/course-structure because
// principal/departments/[id]/page.tsx deep-links here with
// ?catalogId=&departmentId=&regulation=.
const STEPS = [
  { key: "structure", label: "Structure" },
  { key: "subjects", label: "Subjects" },
  { key: "syllabus", label: "Syllabus" },
  { key: "regulation", label: "Regulation Doc" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

function CurriculumPageInner() {
  const picker = useRegulationCourseDepartmentPicker();
  const router = useRouter();
  const searchParams = useSearchParams();

  const stepParam = searchParams.get("step");
  const [step, setStep] = useState<StepKey>(() =>
    STEPS.some((s) => s.key === stepParam) ? (stepParam as StepKey) : "structure"
  );
  useEffect(() => {
    if (stepParam && STEPS.some((s) => s.key === stepParam)) setStep(stepParam as StepKey);
  }, [stepParam]);

  function changeStep(key: StepKey) {
    setStep(key);
    router.replace(`/academics/course-structure?step=${key}`, { scroll: false });
  }

  // Deep-link prefill from principal/departments/[id]/page.tsx
  // (?catalogId=&departmentId=[&regulation=]) - Regulation/Course/Department
  // only; lands on the Structure step by default.
  const [prefill, setPrefill] = useState<{ catalogId: string; departmentId: string; regulation: string | null } | null>(() => {
    const catalogId = searchParams.get("catalogId");
    const departmentId = searchParams.get("departmentId");
    return catalogId && departmentId ? { catalogId, departmentId, regulation: searchParams.get("regulation") } : null;
  });
  useEffect(() => {
    if (!prefill || picker.catalogItems.length === 0) return;
    const item = picker.catalogItems.find((c) => c.id === prefill.catalogId);
    void (async () => {
      setPrefill(null);
      if (!item) return;
      const regs = item.regulations ?? [];
      const reg = prefill.regulation && regs.includes(prefill.regulation) ? prefill.regulation : regs[0] ?? "";
      picker.setSelectedRegulation(reg);
      picker.setSelectedCatalogId(prefill.catalogId);
      picker.selectDepartment(prefill.departmentId);
      await picker.load({ regulation: reg, catalogId: prefill.catalogId, departmentId: prefill.departmentId });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, picker.catalogItems]);

  const canLoad = !!picker.selectedRegulation && !!picker.selectedCatalogId;

  return (
    <div className="space-y-6">
      <div role="tablist" className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {STEPS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={step === s.key}
            onClick={() => changeStep(s.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              step === s.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Regulation</Label>
          <Select value={picker.selectedRegulation} onValueChange={picker.selectRegulation}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Regulation" /></SelectTrigger>
            <SelectContent>
              {picker.topLevelRegulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Course</Label>
          <Select value={picker.selectedCatalogId} onValueChange={picker.selectCatalog} disabled={!picker.selectedRegulation}>
            <SelectTrigger className="w-56"><SelectValue placeholder={!picker.selectedRegulation ? "Select a regulation first" : "Course"} /></SelectTrigger>
            <SelectContent>
              {picker.catalogOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => void picker.load()} disabled={!canLoad || picker.isLoadingData} loading={picker.isLoadingData}>
          Load
        </Button>
        {!picker.isLoaded && canLoad && !picker.isLoadingData && (
          <span className="text-sm text-muted-foreground">Click Load, then switch between the steps above without re-picking this.</span>
        )}
      </div>

      {step === "structure" && <CourseStructureStep picker={picker} />}
      {step === "subjects" && (
        picker.isLoaded
          ? <SubjectsStep initialCatalogId={picker.selectedCatalogId} initialDepartmentId={picker.selectedDepartmentId} />
          : <p className="text-sm text-muted-foreground">Click Load above first - pick the Department on this tab.</p>
      )}
      {step === "syllabus" && <SyllabusStep picker={picker} />}
      {step === "regulation" && <RegulationDocStep picker={picker} />}
    </div>
  );
}

export default function CurriculumPage() {
  return (
    <Suspense fallback={null}>
      <CurriculumPageInner />
    </Suspense>
  );
}
