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

type SubjectForm = {
  serialNumber: string;
  category: SubjectCategory | "";
  customCategory: string;
  name: string;
  code: string;
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
  serialNumber: "", category: "", customCategory: "", name: "", code: "", type: "THEORY",
  lectureHours: "", tutorialHours: "", practicalHours: "",
  hoursPerWeek: "", totalHoursPerSemester: "", credits: "", regulation: "",
};

export default function NewDeanSubjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const departmentId = searchParams.get("departmentId") ?? "";
  const courseId = searchParams.get("courseId") ?? "";
  const year = searchParams.get("year") ?? "";
  const department = searchParams.get("department") ?? "";
  const academicYear = searchParams.get("academicYear") ?? "";
  const regulationFromList = searchParams.get("regulation") ?? "";
  const nextSerialNumber = searchParams.get("nextSerialNumber") ?? "";
  const catalogId = searchParams.get("catalogId") ?? "";
  // Carried through to the success redirect so the Subjects list lands back
  // on this same department/course/year/session/regulation instead of the
  // blank pickers.
  const backHref = `/dean/subjects?departmentId=${encodeURIComponent(departmentId)}&courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}&academicYear=${encodeURIComponent(academicYear)}&regulation=${encodeURIComponent(regulationFromList)}`;

  const [form, setForm] = useState<SubjectForm>({
    ...EMPTY_SUBJECT_FORM, regulation: regulationFromList, serialNumber: nextSerialNumber,
  });
  const [saving, setSaving] = useState(false);
  // This course's OWN assigned regulations (Course Catalog > Regulations,
  // see CourseCatalogSettingsCard) - a narrower set than the college's full
  // declared list, since a different course can use an entirely different
  // set of regulations. Every subject must be tagged with one of these.
  const [regulations, setRegulations] = useState<string[]>([]);
  const [loadedCatalog, setLoadedCatalog] = useState(false);

  useEffect(() => {
    if (!courseId || !year) {
      toast({ variant: "destructive", title: "Select a course, department and year first" });
      router.push("/dean/subjects");
    }
  }, [courseId, year, router]);

  useEffect(() => {
    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>)
      .then((d) => setRegulations((d.items ?? []).find((c) => c.id === catalogId)?.regulations ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load regulations" }))
      .finally(() => setLoadedCatalog(true));
  }, [catalogId]);

  if (!courseId || !year) return null;

  if (loadedCatalog && regulations.length === 0) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Add Subject" description="This course has no regulations assigned yet" />
        <Card>
          <CardContent className="pt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Ask the Principal to assign at least one regulation to this course under Settings &gt; Course Catalog before adding subjects to it.
            </p>
            <Button variant="outline" onClick={() => router.push(backHref)}>Back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  function setF(patch: Partial<SubjectForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) {
      toast({ variant: "destructive", title: "Name and code are required" });
      return;
    }
    if (!form.regulation) {
      toast({ variant: "destructive", title: "Select a regulation" });
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
          year: Number(year),
          department: department || undefined,
          academicYear: academicYear || undefined,
          regulation: form.regulation,
          serialNumber: Number(form.serialNumber),
          category: form.category,
          customCategory: form.category === "OTHER" ? form.customCategory.trim() : undefined,
          name: form.name.trim(),
          code: form.code.trim(),
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
    <div className="max-w-xl">
      <PageHeader
        title="Add Subject"
        description={
          academicYear
            ? `Add a subject offered for this year of the course, for academic year ${academicYear}`
            : "Add a subject offered for this year of the course"
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>S.No. *</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.serialNumber}
                  onChange={(e) => setF({ serialNumber: stripLeadingZeros(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v) => setF({ category: v as SubjectCategory })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
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
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Name of the Subject *</Label>
              <Input value={form.name} onChange={(e) => setF({ name: e.target.value })} placeholder="e.g. Data Structures" />
            </div>

            <div className="space-y-2">
              <Label>Regulation *</Label>
              <Select value={form.regulation} onValueChange={(v) => setF({ regulation: v })}>
                <SelectTrigger><SelectValue placeholder={regulations.length ? "Select regulation" : "No regulations declared yet"} /></SelectTrigger>
                <SelectContent>
                  {regulations.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              {regulations.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Ask the Principal to declare regulations under Settings first.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setF({ code: e.target.value.toUpperCase() })}
                  placeholder="e.g. CS201"
                  className="uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setF({ type: v as SubjectType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SUBJECT_TYPE_LABELS) as [SubjectType, string][]).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>L / T / P *</Label>
              <div className="grid grid-cols-3 gap-4">
                <Input
                  type="number"
                  min={0}
                  placeholder="L"
                  aria-label="Lecture hours"
                  value={form.lectureHours}
                  onChange={(e) => setF({ lectureHours: stripLeadingZeros(e.target.value) })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="T"
                  aria-label="Tutorial hours"
                  value={form.tutorialHours}
                  onChange={(e) => setF({ tutorialHours: stripLeadingZeros(e.target.value) })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="P"
                  aria-label="Practical hours"
                  value={form.practicalHours}
                  onChange={(e) => setF({ practicalHours: stripLeadingZeros(e.target.value) })}
                />
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
