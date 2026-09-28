"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import type { CourseCatalogItem, SubjectCategory, SubjectType } from "@/types";
import { SUBJECT_CATEGORY_LABELS, SUBJECT_TYPE_LABELS } from "@/types";
import { regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";

type SubjectForm = {
  serialNumber: string;
  category: SubjectCategory | "";
  customCategory: string;
  name: string;
  code: string;
  shortCode: string;
  type: SubjectType;
  lectureHours: string;
  tutorialHours: string;
  practicalHours: string;
  hoursPerWeek: string;
  totalHoursPerSemester: string;
  credits: string;
  regulation: string;
};

const EMPTY_SUBJECT_FORM: SubjectForm = {
  serialNumber: "", category: "", customCategory: "", name: "", code: "", shortCode: "", type: "THEORY",
  lectureHours: "", tutorialHours: "", practicalHours: "",
  hoursPerWeek: "", totalHoursPerSemester: "", credits: "", regulation: "",
};

export default function NewAcademicsSubjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const courseId = searchParams.get("courseId") ?? "";
  const academicYear = searchParams.get("academicYear") ?? "";
  const regulationFromList = searchParams.get("regulation") ?? "";
  const nextSerialNumber = searchParams.get("nextSerialNumber") ?? "";
  const catalogId = searchParams.get("catalogId") ?? "";
  // Carried through to the success redirect so the Subjects list lands back
  // on this same course/session/regulation instead of the blank pickers.
  const backHref = `/academics/subjects?courseId=${encodeURIComponent(courseId)}&academicYear=${encodeURIComponent(academicYear)}&regulation=${encodeURIComponent(regulationFromList)}`;

  const [form, setForm] = useState<SubjectForm>({
    ...EMPTY_SUBJECT_FORM, regulation: regulationFromList, serialNumber: nextSerialNumber,
  });
  const [saving, setSaving] = useState(false);
  // Whichever of this course's own regulations (Course Catalog, see
  // CourseCatalogSettingsCard) are assigned to this course - offered
  // as an optional tag, not required (subjects are scoped by course
  // + regulation only; see academics/subjects/page.tsx).
  const [regulations, setRegulations] = useState<string[]>([]);

  useEffect(() => {
    if (!courseId) {
      toast({ variant: "destructive", title: "Select a course first" });
      router.push("/academics/subjects");
    }
  }, [courseId, router]);

  useEffect(() => {
    if (!catalogId) return;
    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>)
      .then((d) => {
        const catalogItem = (d.items ?? []).find((c) => c.id === catalogId);
        // The master subject is scoped by course + regulation only
        // (no year), so show all regulations for this course.
        setRegulations(catalogItem?.regulations ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load regulations" }));
  }, [catalogId]);

  if (!courseId) return null;

  function setF(patch: Partial<SubjectForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) {
      toast({ variant: "destructive", title: "Name and code are required" });
      return;
    }
    if (form.serialNumber === "") {
      toast({ variant: "destructive", title: "S.No. is required" });
      return;
    }
    if (!form.category) {
      toast({ variant: "destructive", title: "Select a category" });
      return;
    }
    if (form.category === "OTHER" && !form.customCategory.trim()) {
      toast({ variant: "destructive", title: "Enter a name for the custom category" });
      return;
    }
    if (form.lectureHours === "" || form.tutorialHours === "" || form.practicalHours === "") {
      toast({ variant: "destructive", title: "L, T and P are required" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/college/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          academicYear: academicYear || undefined,
          regulation: form.regulation,
          serialNumber: Number(form.serialNumber),
          category: form.category,
          customCategory: form.category === "OTHER" ? form.customCategory.trim() : undefined,
          name: form.name.trim(),
          code: form.code.trim(),
          shortCode: form.shortCode.trim() || undefined,
          type: form.type,
          lectureHours: Number(form.lectureHours),
          tutorialHours: Number(form.tutorialHours),
          practicalHours: Number(form.practicalHours),
          hoursPerWeek: form.hoursPerWeek === "" ? 0 : Number(form.hoursPerWeek),
          totalHoursPerSemester: form.totalHoursPerSemester === "" ? null : Number(form.totalHoursPerSemester),
          credits: form.credits === "" ? 0 : Number(form.credits),
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to save subject");
      }
      toast({ variant: "success", title: "Subject added" });
      router.push(backHref);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save subject" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add Subject"
        description="Add a subject to this course and regulation"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-xs text-muted-foreground" id="form-required-note">Fields marked <abbr title="required" className="no-underline font-semibold text-foreground">*</abbr> are required.</p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sno">S.No. *</Label>
                <Input
                  id="sno"
                  type="number"
                  min={0}
                  value={form.serialNumber}
                  onChange={(e) => setF({ serialNumber: stripLeadingZeros(e.target.value) })}
                  aria-required="true"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category *</Label>
                <Select value={form.category} onValueChange={(v) => setF({ category: v as SubjectCategory })}>
                  <SelectTrigger id="category" aria-required="true"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SUBJECT_CATEGORY_LABELS) as [SubjectCategory, string][]).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.category === "OTHER" && (
                  <Input
                    value={form.customCategory}
                    onChange={(e) => setF({ customCategory: e.target.value })}
                    placeholder="Enter category name"
                    aria-label="Custom category name"
                    aria-required="true"
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject-name">Name of the Subject *</Label>
              <Input id="subject-name" value={form.name} onChange={(e) => setF({ name: e.target.value })} placeholder="e.g. Data Structures" aria-required="true" />
            </div>

            <div className="space-y-2">
              <Label>Regulation</Label>
              <Select value={form.regulation} onValueChange={(v) => setF({ regulation: v })} disabled={regulations.length === 0}>
                <SelectTrigger><SelectValue placeholder={regulations.length ? "Select regulation (optional)" : "None resolved for this course"} /></SelectTrigger>
                <SelectContent>
                  {regulations.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              {regulations.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No regulation is assigned to this course yet. The subject will be added without one.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="subject-code">Code *</Label>
                <Input
                  id="subject-code"
                  value={form.code}
                  onChange={(e) => setF({ code: e.target.value.toUpperCase() })}
                  placeholder="e.g. CS201"
                  className="uppercase"
                  aria-required="true"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject-type">Type</Label>
                <Select value={form.type} onValueChange={(v) => setF({ type: v as SubjectType })}>
                  <SelectTrigger id="subject-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SUBJECT_TYPE_LABELS) as [SubjectType, string][]).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Short Code</Label>
              <Input
                value={form.shortCode}
                onChange={(e) => setF({ shortCode: e.target.value.toUpperCase() })}
                placeholder="e.g. DS"
                maxLength={8}
                className="uppercase"
              />
              <p className="text-xs text-muted-foreground">
                A compact mnemonic shown in the timetable and other tight spaces (e.g. &quot;CHE&quot; for Chemistry) - optional, falls back to Code when blank.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Contact Hours (L / T / P) *</Label>
              <p className="text-xs text-muted-foreground -mt-1" id="ltp-description">Lecture / Tutorial / Practical hours per week</p>
              <div className="grid grid-cols-3 gap-4" aria-describedby="ltp-description" role="group" aria-label="Contact hours">
                <div className="space-y-1.5">
                  <Label htmlFor="lecture-hours" className="text-xs text-muted-foreground">Lecture (L)</Label>
                  <Input
                    id="lecture-hours"
                    type="number"
                    min={0}
                    placeholder="0"
                    aria-label="Lecture hours"
                    aria-required="true"
                    value={form.lectureHours}
                    onChange={(e) => setF({ lectureHours: stripLeadingZeros(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tutorial-hours" className="text-xs text-muted-foreground">Tutorial (T)</Label>
                  <Input
                    id="tutorial-hours"
                    type="number"
                    min={0}
                    placeholder="0"
                    aria-label="Tutorial hours"
                    aria-required="true"
                    value={form.tutorialHours}
                    onChange={(e) => setF({ tutorialHours: stripLeadingZeros(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="practical-hours" className="text-xs text-muted-foreground">Practical (P)</Label>
                  <Input
                    id="practical-hours"
                    type="number"
                    min={0}
                    placeholder="0"
                    aria-label="Practical hours"
                    aria-required="true"
                    value={form.practicalHours}
                    onChange={(e) => setF({ practicalHours: stripLeadingZeros(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Hours / Week</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.hoursPerWeek}
                  onChange={(e) => setF({ hoursPerWeek: stripLeadingZeros(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Hours / Semester</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.totalHoursPerSemester}
                  onChange={(e) => setF({ totalHoursPerSemester: stripLeadingZeros(e.target.value) })}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Credits</Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={form.credits}
                onChange={(e) => setF({ credits: stripLeadingZeros(e.target.value) })}
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.push(backHref)}>Cancel</Button>
              <Button type="submit" loading={saving}>Add Subject</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}