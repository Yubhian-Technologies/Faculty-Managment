"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import type { Department } from "@/types";

// Step 1 of a Principal-tier drill (History or Report): every department in
// the college - Principal/VP have no department restriction, unlike the
// equivalent HOD flow which starts one level down at Sections (HOD is
// already scoped to one department). Reuses the existing
// GET /api/college/departments listing. Picking a card drills into
// `${hrefBase}/${department.id}`, an existing nested course/section route
// this component doesn't need to know the shape of.
export function DepartmentAttendancePicker({
  hrefBase,
  title,
  description,
}: { hrefBase: string; title: string; description: string }) {
  const router = useRouter();
  const [departments, setDepartments] = useState<(Department & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/college/departments");
        if (!res.ok) throw new Error("Failed to load departments");
        const json = (await res.json()) as { departments?: (Department & { id: string })[] };
        setDepartments(json.departments ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load departments" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl border bg-muted/30 animate-pulse" />)}
        </div>
      ) : departments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No departments found yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => (
            <Card
              key={d.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => router.push(`${hrefBase}/${d.id}?deptLabel=${encodeURIComponent(d.name)}`)}
            >
              <CardContent className="p-4">
                <p className="font-semibold text-sm leading-tight">{d.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {d.hodName ? `HOD: ${d.hodName}` : "No HOD assigned"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
