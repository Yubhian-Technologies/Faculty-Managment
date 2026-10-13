"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { XCircle } from "lucide-react";
import { semesterInYearLabel } from "@/lib/academic/format";
import type { CourseStructureScopeSummary } from "@/lib/subjects/services/CourseStructureImportService";

// A department's entire curriculum at a glance - every year, every
// semester, what's already assigned, regardless of which regulation. Shared
// by Course Structure (its own import's scope preview) and the Subjects
// tab's two-panel assign view, both of which already resolve the same
// CourseStructureScopeSummary (GET /api/college/subjects/import-and-assign)
// for their own purposes.
export function CurriculumOverviewCard({ scope }: { scope: CourseStructureScopeSummary }) {
  const teachableYears = scope.scope.teachableYears ?? [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Current course structure</CardTitle>
        <p className="text-sm text-muted-foreground">
          {scope.course.name}, {scope.department.name}. Subjects currently assigned to each semester, all regulations.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {teachableYears.length === 0 && (
          <p className="text-sm text-red-600 flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" />No years are assigned to this department for this course. Set its Years Taught before importing.</p>
        )}
        {Array.from({ length: scope.scope.durationYears }, (_, i) => i + 1).map((y) => {
          const taught = teachableYears.includes(y);
          const configured = scope.scope.semestersByYear[y] ?? [];
          const slots = scope.existing.filter((e) => e.year === y);
          const semesters = Array.from(new Set([...configured, ...slots.map((e) => e.semester)])).sort((a, b) => a - b);
          const cov = scope.regulationCoverage.find((c) => c.year === y)?.regulations ?? [];
          return (
            <section key={y} className={`rounded-md border ${taught ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <h3 className="text-sm font-semibold">Year {y}</h3>
                <p className="text-xs text-muted-foreground">
                  {taught ? "Assigned to this department" : "Not assigned to this department"}
                  {cov.length > 0 && `. Current batch regulation: ${cov.join(", ")}`}
                </p>
              </div>
              {semesters.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No semesters configured in Course-Year Timings.</p>
              ) : (
                <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
                  {semesters.map((sem) => {
                    const subjects = slots.find((e) => e.semester === sem)?.subjects ?? [];
                    return (
                      <div key={sem} className="min-w-0 px-3 py-2 space-y-1.5">
                        <p className="text-sm font-medium">
                          {semesterInYearLabel(semesters, sem, { format: "short" })}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {subjects.length} subject{subjects.length !== 1 ? "s" : ""}
                            {!configured.includes(sem) && ", not in Course-Year Timings"}
                          </span>
                        </p>
                        {subjects.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No subjects assigned.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th className="py-1 pr-2 font-medium">Code</th>
                                  <th className="py-1 pr-2 font-medium">Subject</th>
                                  <th className="py-1 pr-2 font-medium whitespace-nowrap">L-T-P</th>
                                  <th className="py-1 pr-2 font-medium">Credits</th>
                                  <th className="py-1 font-medium">Regulation</th>
                                </tr>
                              </thead>
                              <tbody>
                                {subjects.map((sub) => (
                                  <tr key={sub.subjectId} className="border-t">
                                    <td className="py-1 pr-2 font-mono whitespace-nowrap">{sub.code}</td>
                                    <td className="py-1 pr-2">{sub.name}</td>
                                    <td className="py-1 pr-2 tabular-nums whitespace-nowrap">{sub.lectureHours}-{sub.tutorialHours}-{sub.practicalHours}</td>
                                    <td className="py-1 pr-2 tabular-nums">{sub.credits}</td>
                                    <td className={`py-1 ${sub.regulation === scope.regulation ? "" : "text-amber-700"}`}>{sub.regulation || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
