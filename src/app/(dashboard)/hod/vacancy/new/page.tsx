"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import type { FacultyNorms } from "@/types";

// ─── Position catalogue ──────────────────────────────────────────────────────

type Category = "TEACHING" | "SUPPORTING_STAFF";

const TEACHING_ROLES = [
  "Professor",
  "Associate Professor",
  "Assistant Professor",
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewVacancyPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [norms, setNorms] = useState<FacultyNorms | null>(null);

  const [category, setCategory] = useState<Category | "">("");
  const [designation, setDesignation] = useState("");
  const [customDesignation, setCustomDesignation] = useState("");
  const [requiredCount, setRequiredCount] = useState(1);
  const [availableCount, setAvailableCount] = useState(0);
  const [justification, setJustification] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings/faculty-norms")
      .then((r) => r.json() as Promise<{ norms: FacultyNorms }>)
      .then((d) => setNorms(d.norms))
      .catch(() => {});
  }, []);

  // Reset designation when category changes
  function handleCategoryChange(val: Category) {
    setCategory(val);
    setDesignation("");
    setCustomDesignation("");
  }

  const roleOptions =
    category === "TEACHING"
      ? TEACHING_ROLES
      : category === "SUPPORTING_STAFF"
      ? SUPPORTING_ROLES
      : [];

  const finalPosition =
    designation === "Others" ? customDesignation.trim() : designation;

  const isValid =
    !!category &&
    !!designation &&
    (designation !== "Others" || customDesignation.trim().length > 0) &&
    requiredCount >= 1 &&
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
          justification: justification.trim(),
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
        title="New Vacancy Request"
        description="Submit a faculty hiring request to the Principal"
      />

      {/* Govt. Norms Reference */}
      {norms && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-800 flex items-center gap-2">
              <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                {norms.regulatoryBody}
              </span>
              Govt. Faculty Norms (Reference)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3 text-sm text-blue-900 pb-4">
            <div>
              <p className="text-xs font-medium text-blue-600">Student : Faculty Ratio</p>
              <p className="font-semibold">{norms.studentFacultyRatio} : 1</p>
            </div>
            <div>
              <p className="text-xs font-medium text-blue-600">Min. Faculty per Dept</p>
              <p className="font-semibold">{norms.defaultMinFacultyPerDept}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-blue-600">Teaching Hours / Week</p>
              <p className="font-semibold">{norms.teachingHoursPerWeek} hrs</p>
            </div>
          </CardContent>
        </Card>
      )}

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
                <Select value={designation} onValueChange={setDesignation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select designation..." />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((role) => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <span className="font-semibold">{requiredCount}</span> × {finalPosition} &nbsp;·&nbsp; {CATEGORY_LABELS[category as Category]} &nbsp;·&nbsp; {user?.department}
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
