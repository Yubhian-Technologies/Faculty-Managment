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
import { useCollegeType } from "@/hooks/useCollegeType";
import { getTeachingDesignations, getSupportingDesignations } from "@/lib/designations/config";
import { toast } from "@/hooks/useToast";
import { Plus, Trash2 } from "lucide-react";
import type { FacultyRequirementResult } from "@/app/api/college/faculty-requirement/route";

// ─── Position catalogue ──────────────────────────────────────────────────────
// The rich catalogue below (with Dental/Medical-flavored supporting roles and
// AICTE cadre-ratio auto-fill via DESIGNATION_TO_CADRE) is what Engineering/
// Pharmacy/Dental colleges have always used - kept exactly as-is for those.
// Degree/Polytechnic/School colleges instead draw from the shared per-
// college-type lists in src/lib/designations/config.ts (the same ones Faculty/
// Supporting Staff add/edit use), so hiring and staff addition stay in sync.

type Category = "TEACHING" | "SUPPORTING_STAFF";

const TEACHING_ROLES = [
  "Professor & Head",
  "Professor",
  "Associate Professor",
  "Reader",
  "Assistant Professor",
  "Senior Lecturer",
  "Lecturer",
  "Medical Officer",
  "Psychology Counsellor",
  "Others",
] as const;

const SUPPORTING_ROLES = [
  "Assistant Manager (Admin)",
  "Senior Assistant",
  "Junior Assistant",
  "Librarian",
  "Assistant Librarian",
  "Nurse",
  "Lab Technician",
  "Assistant",
  "Lab Assistant",
  "OT Assistant",
  "Sr. Dental Equipment Technician",
  "Dental Equipment Technician",
  "Dental Technician",
  "Radiographer",
  "Receptionist",
  "Stores Incharge",
  "Physical Director",
  "Accounts Officer",
  "Electrician",
  "Plumber",
  "Stores Assistant",
  "Driver",
  "Warden",
  "Assistant Systems Administrator",
  "Trainee Dental Technician",
  "Others",
] as const;

const CATEGORY_LABELS: Record<Category, string> = {
  TEACHING: "Teaching",
  SUPPORTING_STAFF: "Supporting Staff",
};

const DESIGNATION_TO_CADRE: Record<string, "PROFESSOR" | "ASSOCIATE_PROFESSOR" | "ASSISTANT_PROFESSOR"> = {
  "Professor":           "PROFESSOR",
  "Associate Professor": "ASSOCIATE_PROFESSOR",
  "Assistant Professor": "ASSISTANT_PROFESSOR",
  "Senior Lecturer":     "ASSISTANT_PROFESSOR",
  "Lecturer":            "ASSISTANT_PROFESSOR",
};

const QUALIFICATION_OPTIONS = [
  "M.Tech",
  "Ph.D",
  "M.Phil",
  "MCA",
  "M.Sc",
  "MBA",
  "Others",
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type PositionEntry = {
  key: string;
  category: Category | "";
  designation: string;
  customDesignation: string;
  requiredCount: number;
  availableCount: number;
  qualification: string;
  qualificationOther: string;
  justification: string;
};

function newEntry(): PositionEntry {
  return {
    key: Math.random().toString(36).slice(2),
    category: "",
    designation: "",
    customDesignation: "",
    requiredCount: 1,
    availableCount: 0,
    qualification: "",
    qualificationOther: "",
    justification: "",
  };
}

function resolvedQualification(entry: PositionEntry): string {
  return entry.qualification === "Others" ? entry.qualificationOther.trim() : entry.qualification;
}

function isEntryValid(entry: PositionEntry): boolean {
  return (
    !!entry.category &&
    !!entry.designation &&
    (entry.designation !== "Others" || entry.customDesignation.trim().length > 0) &&
    entry.requiredCount >= 1 &&
    resolvedQualification(entry).length > 0 &&
    entry.justification.trim().length >= 10
  );
}

// Names the first missing/invalid field instead of leaving the Submit button
// silently disabled with no explanation of what's wrong.
function getFirstValidationError(entries: PositionEntry[]): string | null {
  if (entries.length === 0) return "Add at least one position before submitting.";
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const label = entries.length > 1 ? `Position ${i + 1}` : "this request";
    if (!entry.category) return `Select a Position Category for ${label}.`;
    if (!entry.designation) return `Select a Designation for ${label}.`;
    if (entry.designation === "Others" && !entry.customDesignation.trim()) return `Specify the Designation for ${label}.`;
    if (!(entry.requiredCount >= 1)) return `Enter a valid Current Hiring Requirement (at least 1) for ${label}.`;
    if (!entry.qualification) return `Select a Required Qualification for ${label}.`;
    if (entry.qualification === "Others" && !entry.qualificationOther.trim()) return `Specify the Qualification for ${label}.`;
    if (entry.justification.trim().length < 10) return `Enter a Justification of at least 10 characters for ${label}.`;
  }
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

// Colleges with their own per-type designation lists (not the Engineering/
// Pharmacy/Dental catalogue above) - see src/lib/designations/config.ts.
const CUSTOM_CATALOGUE_TYPES = ["DEGREE", "POLYTECHNIC", "SCHOOL"];

export default function NewVacancyPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { collegeType } = useCollegeType();
  const usesCustomCatalogue = !!collegeType && CUSTOM_CATALOGUE_TYPES.includes(collegeType);

  const [requirement, setRequirement] = useState<FacultyRequirementResult | null>(null);
  const [reqLoading, setReqLoading] = useState(true);
  const [entries, setEntries] = useState<PositionEntry[]>([newEntry()]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // reqLoading already starts true, so nothing is set synchronously here -
    // a setState in the effect body triggers a cascading render.
    void (async () => {
      try {
        const r = await fetch("/api/college/faculty-requirement");
        setRequirement(r.ok ? ((await r.json()) as FacultyRequirementResult) : null);
      } catch {
        // Non-fatal: the form renders without the requirement summary.
      } finally {
        setReqLoading(false);
      }
    })();
  }, []);

  function updateEntry(key: string, patch: Partial<PositionEntry>) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function handleDesignationChange(key: string, val: string) {
    const patch: Partial<PositionEntry> = { designation: val, customDesignation: "" };

    if (requirement) {
      const cadreKey = DESIGNATION_TO_CADRE[val];
      if (cadreKey) {
        const cadreRow = requirement.cadre.find((c) => c.key === cadreKey);
        if (cadreRow) {
          if (cadreRow.gap > 0) patch.requiredCount = cadreRow.gap;
          patch.availableCount = cadreRow.current;
          patch.justification =
            `Based on department student strength of ${requirement.totalStudents} students, ` +
            `the 1:${requirement.studentFacultyRatio} ratio requires ${requirement.totalRequired} faculty total. ` +
            `Applying the 1:2:6 cadre ratio, ${cadreRow.required} ${cadreRow.label} position(s) are required. ` +
            `Currently ${cadreRow.current} active. Shortage: ${cadreRow.gap} position(s).`;
        }
      }
    }
    updateEntry(key, patch);
  }

  function handleCategoryChange(key: string, val: Category) {
    updateEntry(key, {
      category: val,
      designation: "",
      customDesignation: "",
      requiredCount: 1,
      availableCount: 0,
      justification: "",
    });
  }

  function addEntry() {
    setEntries((prev) => [...prev, newEntry()]);
  }

  function removeEntry(key: string) {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = getFirstValidationError(entries);
    if (validationError) {
      toast({ variant: "destructive", title: "Missing required field", description: validationError });
      return;
    }

    setIsSubmitting(true);
    let successCount = 0;
    let failCount = 0;

    for (const entry of entries) {
      const finalPosition =
        entry.designation === "Others" ? entry.customDesignation.trim() : entry.designation;
      try {
        const res = await fetch("/api/college/vacancy-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            department: user?.department ?? "",
            position: finalPosition,
            positionCategory: entry.category,
            requiredCount: entry.requiredCount,
            availableCount: entry.availableCount,
            qualification: resolvedQualification(entry),
            justification: entry.justification.trim(),
            studentStrength: requirement?.totalStudents ?? 0,
            totalFacultyRequired: requirement?.totalRequired ?? 0,
            cadreRatioData: requirement?.cadre ?? [],
          }),
        });
        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    setIsSubmitting(false);

    if (failCount === 0) {
      toast({
        variant: "success",
        title: successCount === 1 ? "Vacancy request submitted" : `${successCount} vacancy requests submitted`,
        description: "The Principal has been notified.",
      });
      router.push("/hod/vacancy");
    } else if (successCount > 0) {
      toast({
        variant: "destructive",
        title: `${successCount} submitted, ${failCount} failed`,
        description: "Please retry the failed position(s).",
      });
    } else {
      toast({ variant: "destructive", title: "Failed to submit", description: "Please try again." });
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title="New Hiring Request"
        description="Submit one or more faculty vacancy requests to the Principal"
      />

      {reqLoading ? (
        <div className="h-48 rounded-lg border bg-muted/30 animate-pulse" />
      ) : requirement ? (
        <FacultyRequirementPanel data={requirement} highlightDesignation={null} />
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Shared department */}
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">Department</Label>
              <p className="text-sm font-medium">{user?.department ?? "-"}</p>
            </div>
            <Badge variant="secondary" className="text-xs shrink-0">Auto-filled</Badge>
          </CardContent>
        </Card>

        {/* Position entries */}
        {entries.map((entry, idx) => {
          const roleOptions: readonly string[] =
            entry.category === "TEACHING"
              ? usesCustomCatalogue ? [...getTeachingDesignations(collegeType), "Others"] : TEACHING_ROLES
              : entry.category === "SUPPORTING_STAFF"
              ? usesCustomCatalogue ? [...getSupportingDesignations(collegeType), "Others"] : SUPPORTING_ROLES
              : [];

          const finalPosition =
            entry.designation === "Others" ? entry.customDesignation.trim() : entry.designation;

          const highlightedCadre = entry.designation ? (DESIGNATION_TO_CADRE[entry.designation] ?? null) : null;

          return (
            <Card key={entry.key} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Position {entries.length > 1 ? idx + 1 : "Details"}
                  </CardTitle>
                  {entries.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => removeEntry(entry.key)}
                      aria-label="Remove position"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                  {/* Position Category */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Position Category <span className="text-destructive">*</span></Label>
                    <div className="grid grid-cols-2 gap-3">
                      {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => handleCategoryChange(entry.key, cat)}
                          className={`p-3 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                            entry.category === cat
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <span className="block font-semibold">{CATEGORY_LABELS[cat]}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {entry.category && (
                    <div className="space-y-2">
                      <Label>Designation <span className="text-destructive">*</span></Label>
                      <Select value={entry.designation} onValueChange={(v) => handleDesignationChange(entry.key, v)}>
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
                    </div>
                  )}

                  {entry.designation === "Others" && (
                    <div className="space-y-2">
                      <Label>Specify Designation <span className="text-destructive">*</span></Label>
                      <Input
                        value={entry.customDesignation}
                        onChange={(e) => updateEntry(entry.key, { customDesignation: e.target.value })}
                        placeholder="Enter the designation..."
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Required Qualification <span className="text-destructive">*</span></Label>
                    <Select
                      value={entry.qualification}
                      onValueChange={(v) => updateEntry(entry.key, { qualification: v, qualificationOther: "" })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select qualification..." />
                      </SelectTrigger>
                      <SelectContent>
                        {QUALIFICATION_OPTIONS.map((q) => (
                          <SelectItem key={q} value={q}>{q}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {entry.qualification === "Others" && (
                    <div className="space-y-2">
                      <Label>Specify Qualification <span className="text-destructive">*</span></Label>
                      <Input
                        value={entry.qualificationOther}
                        onChange={(e) => updateEntry(entry.key, { qualificationOther: e.target.value })}
                        placeholder="Specify qualification..."
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Current Hiring Requirement <span className="text-destructive">*</span></Label>
                    <Input
                      type="number"
                      min={1}
                      value={entry.requiredCount}
                      onChange={(e) => updateEntry(entry.key, { requiredCount: Number(e.target.value) })}
                    />
                    {highlightedCadre && requirement && (() => {
                      const row = requirement.cadre.find((c) => c.key === highlightedCadre);
                      return row?.gap ? (
                        <p className="text-xs text-red-600">Cadre gap: {row.gap} - auto-filled</p>
                      ) : row?.surplus ? (
                        <p className="text-xs text-blue-600">Surplus of {row.surplus}. Verify before submitting.</p>
                      ) : null;
                    })()}
                  </div>
                  <div className="space-y-2">
                    <Label>Current Staff Available</Label>
                    <Input
                      type="number"
                      min={0}
                      value={entry.availableCount}
                      onChange={(e) => updateEntry(entry.key, { availableCount: Number(e.target.value) })}
                    />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label>Justification <span className="text-destructive">*</span></Label>
                    <Textarea
                      value={entry.justification}
                      onChange={(e) => updateEntry(entry.key, { justification: e.target.value })}
                      placeholder="Explain why this vacancy is required..."
                      rows={3}
                    />
                    {entry.justification.length > 0 && entry.justification.trim().length < 10 && (
                      <p className="text-xs text-destructive">Minimum 10 characters required</p>
                    )}
                  </div>

                  {isEntryValid(entry) && (
                    <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 sm:col-span-2">
                      <span className="font-semibold">{entry.requiredCount}</span> × {finalPosition}
                      &nbsp;·&nbsp; {CATEGORY_LABELS[entry.category as Category]}
                      {requirement && requirement.totalStudents > 0 && (
                        <span className="text-xs ml-2 opacity-80">
                          ({requirement.totalStudents} students · 1:{requirement.studentFacultyRatio} ratio)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Add another position */}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={addEntry}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Another Position
        </Button>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sticky bottom-4 bg-background/80 backdrop-blur py-3 -mx-6 px-6 border-t">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Submit {entries.length > 1 ? `${entries.length} Requests` : "to Principal"}
          </Button>
        </div>
      </form>
    </div>
  );
}
