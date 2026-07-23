"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { FacultyRequirementPanel } from "@/components/shared/FacultyRequirementPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import type { FacultyRequirementResult } from "@/app/api/college/faculty-requirement/route";

// ─── Position catalogue ──────────────────────────────────────────────────────

type Category = "TEACHING" | "SUPPORTING_STAFF";

const TEACHING_ROLES = [
  "Professor",
  "Associate Professor",
  "Assistant Professor",
  "Senior Lecturer",
  "Lecturer",
  "Others",
] as const;

const SUPPORTING_ROLES = [
  "Technical",
  "Non-Technical",
] as const;

const CATEGORY_LABELS: Record<Category, string> = {
  TEACHING: "Teaching",
  SUPPORTING_STAFF: "Supporting Staff",
};

// Map designation label → cadre key (for auto-fill)
const DESIGNATION_TO_CADRE: Record<string, "PROFESSOR" | "ASSOCIATE_PROFESSOR" | "ASSISTANT_PROFESSOR"> = {
  "Professor":          "PROFESSOR",
  "Associate Professor": "ASSOCIATE_PROFESSOR",
  "Assistant Professor": "ASSISTANT_PROFESSOR",
  "Senior Lecturer":    "ASSISTANT_PROFESSOR",
  "Lecturer":           "ASSISTANT_PROFESSOR",
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewVacancyPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [requirement, setRequirement] = useState<FacultyRequirementResult | null>(null);
  const [reqLoading, setReqLoading] = useState(true);

  const [category, setCategory] = useState<Category | "">("");
  const [designation, setDesignation] = useState("");
  const [customDesignation, setCustomDesignation] = useState("");
  const [requiredCount, setRequiredCount] = useState(1);
  const [availableCount, setAvailableCount] = useState(0);
  const [qualification, setQualification] = useState("");
  const [justification, setJustification] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch faculty requirement data on mount
  useEffect(() => {
    setReqLoading(true);
    fetch("/api/college/faculty-requirement")
      .then(async (r) => (r.ok ? (r.json() as Promise<FacultyRequirementResult>) : null))
      .then((d) => setRequirement(d))
      .catch(() => {})
      .finally(() => setReqLoading(false));
  }, []);

  // When designation changes, auto-fill counts from requirement data
  function handleDesignationChange(val: string) {
    setDesignation(val);
    setCustomDesignation("");

    if (!requirement) return;

    const cadreKey = DESIGNATION_TO_CADRE[val];
    if (!cadreKey) return;

    const cadreRow = requirement.cadre.find((c) => c.key === cadreKey);
    if (!cadreRow) return;

    // Auto-fill vacancy count with the gap (but minimum 1)
    if (cadreRow.gap > 0) setRequiredCount(cadreRow.gap);
    // Auto-fill current staff with current count
    setAvailableCount(cadreRow.current);

    // Auto-generate justification
    const justText =
      `Based on department student strength of ${requirement.totalStudents} students, ` +
      `the 1:${requirement.studentFacultyRatio} ratio requires ${requirement.totalRequired} faculty total. ` +
      `Applying the 1:2:6 cadre ratio, ${cadreRow.required} ${cadreRow.label} position(s) are required. ` +
      `Currently ${cadreRow.current} active. Shortage: ${cadreRow.gap} position(s).`;
    setJustification(justText);
  }

  function handleCategoryChange(val: Category) {
    setCategory(val);
    setDesignation("");
    setCustomDesignation("");
    setRequiredCount(1);
    setAvailableCount(0);
    setJustification("");
  }

  const roleOptions =
    category === "TEACHING"
      ? TEACHING_ROLES
      : category === "SUPPORTING_STAFF"
      ? SUPPORTING_ROLES
      : [];

  const finalPosition =
    designation === "Others" ? customDesignation.trim() : designation;

  // Which cadre row is selected (for panel highlight)
  const highlightedCadre = designation ? (DESIGNATION_TO_CADRE[designation] ?? null) : null;

  const isValid =
    !!category &&
    !!designation &&
    (designation !== "Others" || customDesignation.trim().length > 0) &&
    requiredCount >= 1 &&
    qualification.trim().length > 0 &&
    justification.trim().length >= 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) {
      toast({ variant: "destructive", title: "Please fill all required fields" });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/college/vacancy-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: user?.department ?? "",
          position: finalPosition,
          positionCategory: category,
          requiredCount,
          availableCount,
          qualification: qualification.trim(),
          justification: justification.trim(),
          // Attach ratio data for Principal's review
          studentStrength: requirement?.totalStudents ?? 0,
          totalFacultyRequired: requirement?.totalRequired ?? 0,
          cadreRatioData: requirement?.cadre ?? [],
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to submit", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Vacancy request submitted", description: "The Principal has been notified." });
      router.push("/hod/vacancy");
    } catch {
      toast({ variant: "destructive", title: "Network error. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="New Hiring Request"
        description="Submit a faculty hiring request to the Principal"
      />

      {/* Faculty Requirement Panel */}
      {reqLoading ? (
        <div className="h-48 rounded-lg border bg-muted/30 animate-pulse" />
      ) : requirement ? (
        <FacultyRequirementPanel
          data={requirement}
          highlightDesignation={highlightedCadre}
        />
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vacancy Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Department — read-only */}
            <div className="space-y-2">
              <Label>Department</Label>
              <div className="flex items-center gap-2">
                <Input value={user?.department ?? "—"} disabled className="bg-muted" />
                <Badge variant="secondary" className="shrink-0 text-xs">Auto-filled</Badge>
              </div>
            </div>

            {/* Position Category */}
            <div className="space-y-2">
              <Label>Position Category <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleCategoryChange(cat)}
                    className={`p-3 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                      category === cat
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <span className="block font-semibold">{CATEGORY_LABELS[cat]}</span>
                    <span className="text-xs text-muted-foreground font-normal mt-0.5 block">
                      {cat === "TEACHING" ? "Professors & Lecturers" : "Technical & Non-Technical"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Designation */}
            {category && (
              <div className="space-y-2">
                <Label>Designation <span className="text-destructive">*</span></Label>
                <Select value={designation} onValueChange={handleDesignationChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select designation..." />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((role) => {
                      const cadreKey = DESIGNATION_TO_CADRE[role];
                      const cadreRow = requirement?.cadre.find((c) => c.key === cadreKey);
                      return (
                        <SelectItem key={role} value={role}>
                          <span className="flex items-center gap-2">
                            {role}
                            {cadreRow && cadreRow.gap > 0 && (
                              <span className="text-xs text-red-500 font-medium">−{cadreRow.gap}</span>
                            )}
                            {cadreRow && cadreRow.gap === 0 && cadreRow.surplus === 0 && (
                              <span className="text-xs text-green-500">✓</span>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {designation && DESIGNATION_TO_CADRE[designation] && (
                  <p className="text-xs text-muted-foreground">
                    Count auto-filled from cadre gap. You can adjust if needed.
                  </p>
                )}
              </div>
            )}

            {/* Custom designation for "Others" */}
            {designation === "Others" && (
              <div className="space-y-2">
                <Label>Specify Designation <span className="text-destructive">*</span></Label>
                <Input
                  value={customDesignation}
                  onChange={(e) => setCustomDesignation(e.target.value)}
                  placeholder="Enter the designation..."
                />
              </div>
            )}

            {/* Count fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vacancies Required <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={1}
                  value={requiredCount}
                  onChange={(e) => setRequiredCount(Number(e.target.value))}
                />
                {highlightedCadre && requirement && (() => {
                  const row = requirement.cadre.find((c) => c.key === highlightedCadre);
                  return row?.gap ? (
                    <p className="text-xs text-red-600">
                      Cadre gap: {row.gap} — auto-filled from ratio calculation
                    </p>
                  ) : row?.surplus ? (
                    <p className="text-xs text-blue-600">
                      This cadre has a surplus of {row.surplus}. Verify before submitting.
                    </p>
                  ) : null;
                })()}
              </div>
              <div className="space-y-2">
                <Label>Current Staff Available</Label>
                <Input
                  type="number"
                  min={0}
                  value={availableCount}
                  onChange={(e) => setAvailableCount(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Qualification */}
            <div className="space-y-2">
              <Label>Required Qualification <span className="text-destructive">*</span></Label>
              <Input
                value={qualification}
                onChange={(e) => setQualification(e.target.value)}
                placeholder="e.g. M.Tech / Ph.D in Computer Science..."
              />
            </div>

            {/* Justification */}
            <div className="space-y-2">
              <Label>Justification <span className="text-destructive">*</span></Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Explain why this vacancy is required..."
                rows={4}
              />
              {justification.length > 0 && justification.trim().length < 10 && (
                <p className="text-xs text-destructive">Minimum 10 characters required</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary preview */}
        {isValid && (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-4 text-sm">
              <p className="font-medium text-green-800 mb-1">Request Summary</p>
              <p className="text-green-700">
                <span className="font-semibold">{requiredCount}</span> × {finalPosition}
                &nbsp;·&nbsp; {CATEGORY_LABELS[category as Category]}
                &nbsp;·&nbsp; {user?.department}
                {requirement && requirement.totalStudents > 0 && (
                  <span className="text-xs ml-2 opacity-80">
                    (based on {requirement.totalStudents} students · 1:{requirement.studentFacultyRatio} ratio)
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sticky bottom-4 bg-background/80 backdrop-blur py-3 -mx-6 px-6 border-t">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!isValid}>
            Submit to Principal
          </Button>
        </div>
      </form>
    </div>
  );
}
