"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import type { AcademicYear } from "@/types";

export default function AcademicYearsPage() {
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const data = await fetch("/api/college/academic-years")
      .then((r) => r.json() as Promise<{ academicYears: AcademicYear[] }>);
    setAcademicYears(data.academicYears ?? []);
  }

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch(() => toast({ variant: "destructive", title: "Failed to load academic years" }))
      .finally(() => setLoading(false));
  }, []);

  async function addNextYear() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/academic-years", { method: "POST" });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to add year");
      }
      await refresh();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to add year" });
    } finally {
      setSaving(false);
    }
  }

  async function removeLastYear() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/academic-years", { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to remove year");
      }
      await refresh();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to remove year" });
    } finally {
      setSaving(false);
    }
  }

  const sortedYears = academicYears.slice().sort((a, b) => a.yearNumber - b.yearNumber);

  return (
    <div className="space-y-6">
      <PageHeader title="Academic Years" description="Years of study for your college" />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Years of Study</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add years of study for your college, one at a time — sections can only be created for a year that&apos;s been added here.
          </p>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {sortedYears.length === 0 && (
                <p className="text-sm text-muted-foreground border rounded-lg p-3">No years added yet.</p>
              )}
              {sortedYears.map((ay, i, arr) => {
                const isLast = i === arr.length - 1;
                return (
                  <div key={ay.id} className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm font-medium">{ay.label ?? yearOrdinalLabel(ay.yearNumber)}</span>
                    {isLast && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        loading={saving}
                        onClick={() => void removeLastYear()}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <Button type="button" variant="outline" className="w-full" loading={saving} onClick={() => void addNextYear()}>
            <Plus className="h-4 w-4 mr-2" />
            Add {yearOrdinalLabel(Math.max(0, ...academicYears.map((ay) => ay.yearNumber)) + 1)}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
