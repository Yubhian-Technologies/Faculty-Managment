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
import { Plus, Trash2 } from "lucide-react";
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

const DESIGNATION_TO_CADRE: Record<string, "PROFESSOR" | "ASSOCIATE_PROFESSOR" | "ASSISTANT_PROFESSOR"> = {
  "Professor":           "PROFESSOR",
  "Associate Professor": "ASSOCIATE_PROFESSOR",
  "Assistant Professor": "ASSISTANT_PROFESSOR",
  "Senior Lecturer":     "ASSISTANT_PROFESSOR",
  "Lecturer":            "ASSISTANT_PROFESSOR",
};

// ─── Types ───────────────────────────────────────────────────────────────────

type PositionEntry = {
  key: string;
  category: Category | "";
  designation: string;
  customDesignation: string;
  requiredCount: number;
  availableCount: number;
  qualification: string;
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
    justification: "",
  };
}

function isEntryValid(entry: PositionEntry): boolean {
  return (
    !!entry.category &&
    !!entry.designation &&
    (entry.designation !== "Others" || entry.customDesignation.trim().length > 0) &&
    entry.requiredCount >= 1 &&
    entry.qualification.trim().length > 0 &&
    entry.justification.trim().length >= 10
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewVacancyPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [requirement, setRequirement] = useState<FacultyRequirementResult | null>(null);
  const [reqLoading, setReqLoading] = useState(true);
  const [entries, setEntries] = useState<PositionEntry[]>([newEntry()]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setReqLoading(true);
    fetch("/api/college/faculty-requirement")
      .then(async (r) => (r.ok ? (r.json() as Promise<FacultyRequirementResult>) : null))
      .then((d) => setRequirement(d))
      .catch(() => {})
      .finally(() => setReqLoading(false));
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

  const allValid = entries.length > 0 && entries.every(isEntryValid);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allValid) {
      toast({ variant: "destructive", title: "Please fill all required fields for every position" });
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
            qualification: entry.qualification.trim(),
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
    <div className="max-w-2xl space-y-5">
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
              <p className="text-sm font-medium">{user?.department ?? "—"}</p>
            </div>
            <Badge variant="secondary" className="text-xs shrink-0">Auto-filled</Badge>
          </CardContent>
        </Card>

        {/* Position entries */}
        {entries.map((entry, idx) => {
          const roleOptions =
            entry.category === "TEACHING"
              ? TEACHING_ROLES
              : entry.category === "SUPPORTING_STAFF"
              ? SUPPORTING_ROLES
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
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Position Category */}
                <div className="space-y-2">
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
                        <span className="text-xs text-muted-foreground font-normal mt-0.5 block">
                          {cat === "TEACHING" ? "Professors & Lecturers" : "Technical & Non-Technical"}
                        </span>
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Vacancies Required <span className="text-destructive">*</span></Label>
                    <Input
                      type="number"
                      min={1}
                      value={entry.requiredCount}
                      onChange={(e) => updateEntry(entry.key, { requiredCount: Number(e.target.value) })}
                    />
                    {highlightedCadre && requirement && (() => {
                      const row = requirement.cadre.find((c) => c.key === highlightedCadre);
                      return row?.gap ? (
                        <p className="text-xs text-red-600">Cadre gap: {row.gap} — auto-filled</p>
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
                </div>

                <div className="space-y-2">
                  <Label>Required Qualification <span className="text-destructive">*</span></Label>
                  <Input
                    value={entry.qualification}
                    onChange={(e) => updateEntry(entry.key, { qualification: e.target.value })}
                    placeholder="e.g. M.Tech / Ph.D in Computer Science..."
                  />
                </div>

                <div className="space-y-2">
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
                  <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                    <span className="font-semibold">{entry.requiredCount}</span> × {finalPosition}
                    &nbsp;·&nbsp; {CATEGORY_LABELS[entry.category as Category]}
                    {requirement && requirement.totalStudents > 0 && (
                      <span className="text-xs ml-2 opacity-80">
                        ({requirement.totalStudents} students · 1:{requirement.studentFacultyRatio} ratio)
                      </span>
                    )}
                  </div>
                )}
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
          <Button type="submit" loading={isSubmitting} disabled={!allValid}>
            Submit {entries.length > 1 ? `${entries.length} Requests` : "to Principal"}
          </Button>
        </div>
      </form>
    </div>
  );
}
