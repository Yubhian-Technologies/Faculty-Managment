"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Course } from "@/types";

type FacultyOption = { id: string; name: string; designation: string };

const STUDENT_FACULTY_RATIO = 15;

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

type SectionForm = {
  courseId: string;
  name: string;
  year: string;
  batch: string;
  studentCount: number | "";
  facultyInchargeUid: string;
  facultyInchargeName: string;
};

export default function NewSectionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledCourseId = searchParams.get("courseId") ?? "";

  const [courses, setCourses] = useState<Course[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);
  const [form, setForm] = useState<SectionForm>({
    courseId: prefilledCourseId,
    name: "",
    year: "",
    batch: "",
    studentCount: "",
    facultyInchargeUid: "",
    facultyInchargeName: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));

    fetch("/api/college/faculty?status=ACTIVE")
      .then((r) => r.json())
      .then((d: { faculty?: { id: string; name: string; designation: string }[] }) => {
        setFacultyList((d.faculty ?? []).map((f) => ({ id: f.id, name: f.name, designation: f.designation })));
      })
      .catch(() => { /* non-critical */ });
  }, []);

  function setF(patch: Partial<SectionForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function handleFacultySelect(facultyId: string) {
    if (!facultyId) {
      setF({ facultyInchargeUid: "", facultyInchargeName: "" });
      return;
    }
    const f = facultyList.find((x) => x.id === facultyId);
    setF({ facultyInchargeUid: facultyId, facultyInchargeName: f?.name ?? "" });
  }

  const formCourse = useMemo(() => courses.find((c) => c.id === form.courseId) ?? null, [courses, form.courseId]);
  const formYearOptions = useMemo(
    () => (formCourse ? Array.from({ length: formCourse.durationYears }, (_, i) => i + 1) : []),
    [formCourse]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.courseId) { toast({ variant: "destructive", title: "Course is required" }); return; }
    if (!form.name.trim()) { toast({ variant: "destructive", title: "Section name is required" }); return; }
    if (!form.year) { toast({ variant: "destructive", title: "Year is required" }); return; }
    if (!form.batch.trim()) { toast({ variant: "destructive", title: "Batch is required (e.g. 2023-2027)" }); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/college/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: form.courseId,
          name: form.name,
          year: Number(form.year),
          batch: form.batch,
          studentCount: form.studentCount === "" ? 0 : Number(form.studentCount),
          facultyInchargeUid: form.facultyInchargeUid || null,
          facultyInchargeName: form.facultyInchargeName,
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to save" });
        return;
      }
      toast({ variant: "success", title: "Section created" });
      router.push("/hod/sections");
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Add Section"
        description="Create a new class section for your department"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Section Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Course *</Label>
              <Select value={form.courseId} onValueChange={(v) => setF({ courseId: v, year: "" })}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Section Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setF({ name: e.target.value.toUpperCase() })}
                  placeholder="A, B, C…"
                  maxLength={5}
                  className="uppercase"
                />
                <p className="text-xs text-muted-foreground">e.g. A, B, C or CS-A</p>
              </div>
              <div className="space-y-2">
                <Label>Year *</Label>
                <Select value={form.year} onValueChange={(v) => setF({ year: v })} disabled={!formCourse}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {formYearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Batch *</Label>
              <Input
                value={form.batch}
                onChange={(e) => setF({ batch: e.target.value })}
                placeholder="e.g. 2023-2027"
              />
              <p className="text-xs text-muted-foreground">Admission year to passout year</p>
            </div>

            <div className="space-y-2">
              <Label>Student Intake</Label>
              <Input
                type="number"
                min={0}
                value={form.studentCount}
                onChange={(e) => setF({ studentCount: e.target.value === "" ? "" : Number(e.target.value) })}
                placeholder="e.g. 60"
              />
              {form.studentCount !== "" && Number(form.studentCount) > 0 && (
                <p className="text-xs text-blue-600 font-medium">
                  Faculty required (1:{STUDENT_FACULTY_RATIO} ratio): {Math.ceil(Number(form.studentCount) / STUDENT_FACULTY_RATIO)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Faculty Incharge</Label>
              <Select
                value={form.facultyInchargeUid || "none"}
                onValueChange={(v) => handleFacultySelect(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select faculty incharge" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Not assigned —</SelectItem>
                  {facultyList.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {facultyList.length === 0 && (
                <p className="text-xs text-muted-foreground">No active faculty found in your department.</p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Create Section</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
