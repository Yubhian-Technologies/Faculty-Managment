"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { classRepresentativeCountOf, MAX_CLASS_REPRESENTATIVES } from "@/lib/sections/classRepresentatives";
import type { SectionListItem } from "@/types";

// The HOD decides how many Class Representatives the department's sections have (0-2) - one number for the whole
// department. Each section's class incharge then picks that many students from the section's roster
// (Students > Class Representatives).
export default function ClassRepresentativesSettingsPage() {
  const [sections, setSections] = useState<SectionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingDept, setSavingDept] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/sections");
        const json = await res.json() as { sections?: SectionListItem[] };
        setSections((json.sections ?? []).filter((s) => s.accessLevel !== "secondary"));
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const departments = useMemo(() => {
    const byDept = new Map<string, SectionListItem[]>();
    for (const s of sections) byDept.set(s.department, [...(byDept.get(s.department) ?? []), s]);
    return Array.from(byDept, ([name, rows]) => ({ name, rows })).sort((a, b) => a.name.localeCompare(b.name));
  }, [sections]);

  async function setDepartmentCount(department: string, count: number) {
    setSavingDept(department);
    try {
      const res = await fetch("/api/college/section-class-representatives", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, count }),
      });
      const json = await res.json() as { error?: string; sections?: { id: string; classRepresentatives: SectionListItem["classRepresentatives"] }[] };
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      const picksById = new Map((json.sections ?? []).map((x) => [x.id, x.classRepresentatives]));
      setSections((prev) => prev.map((s) => (s.department === department
        ? { ...s, classRepresentativeCount: count, classRepresentatives: picksById.get(s.id) ?? s.classRepresentatives }
        : s)));
      toast({ variant: "success", title: `${department}: ${count} Class Representative${count === 1 ? "" : "s"} per section` });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setSavingDept(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class Representatives"
        description="Set how many Class Representatives each section of the department has. The class incharge then picks them from the section's students."
      />
      {isLoading ? (
        <CardSkeleton />
      ) : departments.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No sections yet.</CardContent></Card>
      ) : (
        departments.map(({ name, rows }) => {
          const counts = new Set(rows.map((s) => classRepresentativeCountOf(s)));
          const uniform = counts.size === 1 ? String(Array.from(counts)[0]) : "";
          return (
            <Card key={name}>
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <p className="font-semibold">{name}</p>
                    <p className="text-xs text-muted-foreground">Applies to all {rows.length} section{rows.length === 1 ? "" : "s"} of the department</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Class Representatives per section</span>
                    <Select value={uniform} onValueChange={(v) => void setDepartmentCount(name, Number(v))} disabled={savingDept === name}>
                      <SelectTrigger className="w-28" aria-label={`Class Representatives per section for ${name}`}>
                        <SelectValue placeholder="Mixed" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: MAX_CLASS_REPRESENTATIVES + 1 }, (_, n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="divide-y">
                  {rows.map((s) => (
                    <div key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-2.5 text-sm sm:grid-cols-[2fr_1.5fr_8rem]">
                      <div>
                        <p className="font-medium">Section {s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.courseName ? `${s.courseName} · ` : ""}Year {s.year} · {s.batch}</p>
                      </div>
                      <span className="hidden sm:block text-muted-foreground">Class I/c: {s.facultyInchargeName || "Not assigned"}</span>
                      <span className="text-muted-foreground text-right">{(s.classRepresentatives ?? []).length} of {classRepresentativeCountOf(s)} picked</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
