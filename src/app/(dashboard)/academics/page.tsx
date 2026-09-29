"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { ROLE_LABELS } from "@/types";
import { CourseCatalogSettingsCard } from "@/components/academics/CourseCatalogSettingsCard";
import { Library, CalendarRange, BookOpen, ArrowRight } from "lucide-react";

export default function AcademicsDashboard() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [courseCount, setCourseCount] = useState<number | null>(null);

  useEffect(() => {
    // Load a quick count of active courses for the stat chip
    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses?: { isActive?: boolean }[] }>)
      .then((d) => {
        const active = (d.courses ?? []).filter((c) => c.isActive !== false);
        setCourseCount(active.length);
      })
      .catch(() => setCourseCount(null));
  }, []);

  return (
    <div className="space-y-8">
      {/* Welcome header */}
      <div>
        <PageHeader
          title={`Hello, ${user?.name ?? "there"}`}
          description={ROLE_LABELS.ACADEMICS}
        />

        {/* Quick stats row */}
        {courseCount !== null && (
          <div className="flex flex-wrap gap-3 mt-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {courseCount} active {courseCount === 1 ? "course" : "courses"}
            </span>
          </div>
        )}
      </div>


      {/* Quick action cards */}
      <section aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Your main tasks
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="group cursor-pointer transition-shadow hover:shadow-md" role="link" tabIndex={0}
            onClick={() => router.push("/academics/subjects")}
            onKeyDown={(e) => e.key === "Enter" && router.push("/academics/subjects")}
            aria-label="Go to Subjects"
          >
            <CardHeader className="pb-3">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Library className="h-5 w-5" aria-hidden="true" />
              </div>
              <CardTitle className="text-base">Subjects</CardTitle>
              <CardDescription>
                Add, edit, and manage subjects for each course and regulation. Export subject lists as XLSX or DOCX.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button variant="ghost" size="sm" className="px-0 text-primary gap-1 group-hover:gap-2 transition-all" tabIndex={-1}>
                Open Subjects <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>

          <Card className="group cursor-pointer transition-shadow hover:shadow-md" role="link" tabIndex={0}
            onClick={() => router.push("/academics/assign-semester")}
            onKeyDown={(e) => e.key === "Enter" && router.push("/academics/assign-semester")}
            aria-label="Go to Assign to Semester"
          >
            <CardHeader className="pb-3">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CalendarRange className="h-5 w-5" aria-hidden="true" />
              </div>
              <CardTitle className="text-base">Assign to Semester</CardTitle>
              <CardDescription>
                Map master subjects into specific semesters, per department. Control which subjects students study each semester.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button variant="ghost" size="sm" className="px-0 text-primary gap-1 group-hover:gap-2 transition-all" tabIndex={-1}>
                Open Assign to Semester <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Course Catalog — regulations management */}
      <section aria-labelledby="course-catalog-heading">
        <div className="mb-3">
          <h2 id="course-catalog-heading" className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Course Regulations
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Manage which curriculum regulations (e.g. R23) apply to each course. Departments and other
            users will see these when adding subjects or assigning semesters.
          </p>
        </div>
        {/* Courses are created by the Principal / VP / College Admin; the Academics
            maintains each course's curriculum regulations and their intake
            batches here (see CourseCatalogSettingsCard/RegulationBatchesEditor). */}
        <CourseCatalogSettingsCard regulationsOnly />
      </section>
    </div>
  );
}
