"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { CourseStructureStep } from "@/components/academics/CourseStructureStep";
import { SubjectsStep } from "@/components/academics/SubjectsStep";
import { AlertTriangle } from "lucide-react";
import { useCourseSemesterPlan } from "@/hooks/useCourseSemesterPlan";
import { offeredYears } from "@/lib/college/departmentYears";
import { courseYearNumbers, semesterLabel } from "@/lib/college/courseYears";

// Curriculum: one scope (Regulation -> Course -> Department, including any
// sub-department), picked ONCE in the bar below, shared by every step -
// instead of the old 4 separate pages (Regulation, Course Structure,
// Subjects, Syllabus) each asking for it from scratch, and instead of the
// Subjects tab additionally asking for its own, separate Department filter
// (merged in here - see the Department/Sub-department Selects below). The
// URL/route stays /academics/course-structure because
// principal/departments/[id]/page.tsx deep-links here with
// ?catalogId=&departmentId=&regulation=.
// Syllabus and Regulation Doc are no longer their own steps - they're a
// Documents switcher inside Structure (CourseStructureStep.tsx), since each
// was a single upload card on its own page with nothing else on it.
// Department/Sub-department are shown only where something actually reads
// them: the Subjects tab (assigning subjects to a department's year/
// semester) and Structure's own Syllabus document view (department-
// specific) - see showDepartmentFilter below. Regulation Document and
// Import Subjects are Regulation+Course only (catalog-wide), so the filter
// stays hidden there instead of sitting on screen doing nothing.
const STEPS = [
  { key: "structure", label: "Structure" },
  { key: "subjects", label: "Subjects" },
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

  // Structure's own Documents sub-view (Regulation Document vs Syllabus),
  // lifted up from CourseStructureStep so this bar can react to it: the
  // Regulation Document and Import Subjects both work off Regulation+Course
  // alone (catalog-wide), so Department has nothing to do there, while
  // Syllabus is department-specific and the Subjects tab is inherently
  // department-scoped - see showDepartmentFilter below.
  const [docView, setDocView] = useState<"regulation" | "syllabus">("regulation");
  const showDepartmentFilter = step === "subjects" || (step === "structure" && docView === "syllabus");

  // Department (merged in here from what used to be the Subjects tab's own,
  // separate Department + Sub-department filter) - picker.selectedDepartmentId
  // can already be a sub-department's id (deep-link prefill, or picked below),
  // so the top-level Select always shows/drives the PARENT, and a second
  // Select narrows to one of its children when it has any.
  const selectedDeptRecord = picker.allDepartments.find((d) => d.id === picker.selectedDepartmentId);
  const topDeptId = selectedDeptRecord?.parentDepartmentId ?? picker.selectedDepartmentId;
  const subDeptOptions = picker.childrenOf.get(topDeptId) ?? [];
  const subDeptIdValue = selectedDeptRecord?.parentDepartmentId ? picker.selectedDepartmentId : "";

  // Year/Semester (merged in here from what used to be the Subjects tab's own
  // second filter card) - need the selected department's own courses, fetched
  // EAGERLY (not gated behind the Load button below) so these two Selects
  // have options to show as soon as a Department is picked, same as the
  // Subjects tab used to provide via its own independent course fetch.
  useEffect(() => {
    if (picker.selectedDepartmentId) void picker.loadCourses(picker.selectedDepartmentId);
  }, [picker.selectedDepartmentId]);
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  // A pick that falls outside the options - after changing department, say -
  // clears here (derived, not corrected in an effect) rather than silently
  // becoming another year.
  useEffect(() => { setYear(""); setSemester(""); }, [picker.selectedDepartmentId]);
  const plan = useCourseSemesterPlan(picker.selectedCourse);
  const yearOptions = useMemo(
    () => offeredYears(picker.selectedDepartment ?? undefined, picker.allDepartments, picker.selectedCatalogId || undefined, courseYearNumbers(picker.selectedCourse?.durationYears)),
    [picker.selectedDepartment, picker.allDepartments, picker.selectedCatalogId, picker.selectedCourse]
  );
  const yearValue = yearOptions.includes(Number(year)) ? year : "";
  const semesterOptions = useMemo(
    () => (yearValue && plan.source === "timings" ? plan.semesters.filter((sem) => plan.yearOf(sem) === Number(yearValue)) : []),
    [plan, yearValue]
  );
  const semesterValue = semesterOptions.includes(Number(semester)) ? semester : "";

  // Bumped on every Load click; SubjectsStep reacts to the change (never to
  // the initial mount value - see its own loadToken effect) instead of
  // owning a second Load button of its own.
  const [loadToken, setLoadToken] = useState(0);
  async function handleLoad() {
    await picker.load();
    setLoadToken((t) => t + 1);
  }

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
        {showDepartmentFilter && (
          <div className="space-y-1.5">
            <Label className="text-xs">Department</Label>
            {/* Needed for the Subjects tab and for Syllabus (department-
                specific); Regulation Document and Import Subjects work off
                Regulation+Course alone, so this is hidden there instead of
                shown-but-ignored - see showDepartmentFilter above. */}
            <Select value={topDeptId} onValueChange={picker.selectDepartment} disabled={!picker.selectedCatalogId}>
              <SelectTrigger className="w-56"><SelectValue placeholder={!picker.selectedCatalogId ? "Select a course first" : "Department"} /></SelectTrigger>
              <SelectContent>
                {picker.departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {showDepartmentFilter && subDeptOptions.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Sub-department</Label>
            <Select value={subDeptIdValue || "itself"} onValueChange={(v) => picker.selectDepartment(v === "itself" ? topDeptId : v)}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Sub-department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="itself">Department itself</SelectItem>
                {subDeptOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {/* Only the Subjects tab needs Year/Semester - Structure works across
            a whole course at once. */}
        {step === "subjects" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Year</Label>
              <Select value={yearValue} onValueChange={setYear} disabled={!picker.selectedDepartmentId}>
                <SelectTrigger className="w-28"><SelectValue placeholder="Year" /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{`Year ${y}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Semester</Label>
              <Select value={semesterValue} onValueChange={setSemester} disabled={!yearValue}>
                <SelectTrigger className="w-28"><SelectValue placeholder="Sem" /></SelectTrigger>
                <SelectContent>
                  {/* The label is the course's own year-semester position -
                      "1-1", "1-2", "1-3" where a year has three - and
                      nothing else. */}
                  {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>{semesterLabel(plan, s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        <Button onClick={() => void handleLoad()} disabled={!canLoad || picker.isLoadingData} loading={picker.isLoadingData}>
          Load
        </Button>
        {!picker.isLoaded && canLoad && !picker.isLoadingData && (
          <span className="text-sm text-muted-foreground">Click Load, then switch between the steps above without re-picking this.</span>
        )}
      </div>

      {step === "structure" && <CourseStructureStep picker={picker} docView={docView} setDocView={setDocView} />}
      {step === "subjects" && (
        canLoad
          ? (
            <SubjectsStep
              initialCatalogId={picker.selectedCatalogId}
              initialDepartmentId={picker.selectedDepartmentId}
              initialRegulation={picker.selectedRegulation}
              year={yearValue}
              semester={semesterValue}
              loadToken={loadToken}
            />
          )
          : <p className="text-sm text-muted-foreground">Pick a Regulation and Course above first.</p>
      )}
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
