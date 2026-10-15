"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { MasterSubjectsStep } from "@/components/academics/MasterSubjectsStep";
import { AssignByCodeStep } from "@/components/academics/AssignByCodeStep";
import { DocumentsStep } from "@/components/academics/DocumentsStep";

// Curriculum: ONE flow, one scope (Regulation -> Course) picked once in the bar below and shared by
// every tab:
//   1. Subjects  - the course + regulation's master list: bulk import or add one at a time.
//   2. Assign    - put those subjects into a department's year + semester by typing their codes.
//   3. Documents - the Regulation Document and the Syllabus (no subjects).
// There is no other way to create or assign a subject. The route stays /academics/course-structure
// because principal/departments/[id]/page.tsx deep-links here with ?catalogId=&departmentId=&regulation=
// (that link lands on Assign); the old ?step=structure link maps to Assign too.
const STEPS = [
  { key: "subjects", label: "Subjects" },
  { key: "assign", label: "Assign" },
  { key: "documents", label: "Documents" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];
const LEGACY_STEP: Record<string, StepKey> = { structure: "assign" };
const asStep = (v: string | null): StepKey | null =>
  STEPS.some((s) => s.key === v) ? (v as StepKey) : v && LEGACY_STEP[v] ? LEGACY_STEP[v] : null;

function CurriculumPageInner() {
  const picker = useRegulationCourseDepartmentPicker();
  const router = useRouter();
  const searchParams = useSearchParams();

  const stepParam = searchParams.get("step");
  const deepLinked = !!(searchParams.get("catalogId") && searchParams.get("departmentId"));
  const [step, setStep] = useState<StepKey>(() => asStep(stepParam) ?? (deepLinked ? "assign" : "subjects"));
  useEffect(() => {
    const next = asStep(stepParam);
    if (next) setStep(next);
  }, [stepParam]);

  function changeStep(key: StepKey) {
    setStep(key);
    router.replace(`/academics/course-structure?step=${key}`, { scroll: false });
  }

  // Deep-link prefill from principal/departments/[id]/page.tsx
  // (?catalogId=&departmentId=[&regulation=]) - Regulation/Course/Department
  // only; lands on the Assign step by default.
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
          <span className="text-sm text-muted-foreground">Click Load, then switch between the tabs above without re-picking this.</span>
        )}
      </div>

      {step === "subjects" && <MasterSubjectsStep picker={picker} />}
      {step === "assign" && (
        picker.isLoaded
          ? <AssignByCodeStep
              catalogId={picker.selectedCatalogId}
              regulation={picker.selectedRegulation}
              courseName={picker.selectedCatalogItem?.name ?? ""}
              initialDepartmentId={picker.selectedDepartmentId || undefined}
            />
          : <p className="text-sm text-muted-foreground">Pick a Regulation and Course above, then click Load.</p>
      )}
      {step === "documents" && <DocumentsStep picker={picker} />}
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
