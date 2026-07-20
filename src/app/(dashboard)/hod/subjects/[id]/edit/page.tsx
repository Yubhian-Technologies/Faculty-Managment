"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import type { Subject, SubjectType } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";

type SubjectForm = {
  name: string;
  code: string;
  type: SubjectType;
  hoursPerWeek: string;
  totalHoursPerSemester: string;
  credits: string;
};

const EMPTY_SUBJECT_FORM: SubjectForm = {
  name: "", code: "", type: "THEORY", hoursPerWeek: "", totalHoursPerSemester: "", credits: "",
};

export default function EditSubjectPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const subjectId = params.id;
  const searchParams = useSearchParams();
  const courseId = searchParams.get("courseId") ?? "";
  const year = searchParams.get("year") ?? "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SubjectForm>(EMPTY_SUBJECT_FORM);

  useEffect(() => {
    if (!courseId || !year) {
      toast({ variant: "destructive", title: "Select a course and year first" });
      router.push("/hod/subjects");
      return;
    }
    fetch(`/api/college/subjects?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
      .then((r) => r.json() as Promise<{ subjects: Subject[] }>)
      .then((d) => {
        const s = (d.subjects ?? []).find((x) => x.id === subjectId);
        if (!s) {
          toast({ variant: "destructive", title: "Subject not found" });
          router.push("/hod/subjects");
          return;
        }
        setForm({
          name: s.name,
          code: s.code,
          type: s.type,
          hoursPerWeek: String(s.hoursPerWeek ?? ""),
          totalHoursPerSemester: s.totalHoursPerSemester != null ? String(s.totalHoursPerSemester) : "",
          credits: String(s.credits ?? ""),
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load subject" }))
      .finally(() => setLoading(false));
  }, [courseId, year, subjectId, router]);

  function setF(patch: Partial<SubjectForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) {
      toast({ variant: "destructive", title: "Name and code are required" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/college/subjects/${subjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          year: Number(year),
          name: form.name.trim(),
          code: form.code.trim(),
          type: form.type,
          hoursPerWeek: form.hoursPerWeek === "" ? 0 : Number(form.hoursPerWeek),
          totalHoursPerSemester: form.totalHoursPerSemester === "" ? null : Number(form.totalHoursPerSemester),
          credits: form.credits === "" ? 0 : Number(form.credits),
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to save subject");
      }
      toast({ variant: "success", title: "Subject updated" });
      router.push("/hod/subjects");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save subject" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit Subject" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Edit Subject"
        description="Update this subject's details"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Subject Name *</Label>
              <Input value={form.name} onChange={(e) => setF({ name: e.target.value })} placeholder="e.g. Data Structures" />
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
                value={form.credits}
                onChange={(e) => setF({ credits: stripLeadingZeros(e.target.value) })}
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
