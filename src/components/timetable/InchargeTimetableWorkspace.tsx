"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Search, UserCog, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimetableGridEditor } from "@/components/timetable/TimetableGridEditor";
import { toast } from "@/hooks/useToast";
import { ordinalYear } from "@/lib/timetable/gridModel";
import type { Section, TimetableIncharge } from "@/types";

// A delegated Timetable Incharge's whole timetable workflow on ONE page:
// pick the course-year they were made responsible for, pick a section, press
// Load, and the grid opens in place. Replaces the cards -> section list ->
// grid chain of pages, and is the single implementation behind both
// panel/timetable-incharge and college-staff/timetable-incharge (they used to
// be near-identical copies). Teaching Assignments stays its own page - it is
// a different editor, not another step of this one.
export function InchargeTimetableWorkspace({ basePath }: { basePath: string }) {
  const [incharges, setIncharges] = useState<TimetableIncharge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unit, setUnit] = useState(""); // `${courseId}|${year}`
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [loaded, setLoaded] = useState<{ courseId: string; year: string; sectionId: string } | null>(null);

  async function loadSections(key: string) {
    const [courseId, year] = key.split("|");
    setIsLoadingSections(true);
    try {
      const res = await fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`);
      const json = (await res.json()) as { sections?: Section[] };
      const list = (json.sections ?? []).sort((a, b) => a.name.localeCompare(b.name));
      setSections(list);
      setSectionId(list.length === 1 ? list[0].id : "");
    } catch {
      setSections([]);
      toast({ variant: "destructive", title: "Failed to load sections" });
    } finally {
      setIsLoadingSections(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/timetable-incharges?mine=true");
        const data = (await res.json()) as { incharges?: TimetableIncharge[] };
        const list = data.incharges ?? [];
        setIncharges(list);
        // A single responsibility is auto-picked - fetch its sections now.
        if (list.length === 1) void loadSections(`${list[0].courseId}|${list[0].year}`);
      } catch {
        toast({ variant: "destructive", title: "Failed to load your Timetable responsibilities" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const unitKey = (i: TimetableIncharge) => `${i.courseId}|${i.year}`;
  // A single responsibility needs no picking.
  const effectiveUnit = unit || (incharges.length === 1 ? unitKey(incharges[0]) : "");
  const selected = incharges.find((i) => unitKey(i) === effectiveUnit) ?? null;

  function pickUnit(key: string) {
    setUnit(key);
    setLoaded(null);
    setSectionId("");
    setSections([]);
    void loadSections(key);
  }

  function handleLoad() {
    const section = sections.find((s) => s.id === sectionId);
    if (!selected || !section) return;
    // The section's OWN courseId (a shared-year section can be filed under a
    // sibling branch's Course doc) - same rule as hod/timetable.
    setLoaded({ courseId: section.courseId, year: String(selected.year), sectionId: section.id });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description="Pick the course & year you are Timetable Incharge for and a section, then load its timetable"
      />

      {isLoading ? (
        <div className="h-32 rounded-lg border bg-muted/30 animate-pulse" />
      ) : incharges.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-6 w-6" />}
          title="No responsibilities assigned yet"
          description="Once your HOD makes you Timetable Incharge for a course & year, it shows up here."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Find a section</CardTitle>
              <CardDescription>Nothing loads until you press Load.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Course &amp; year</Label>
                  <Select value={effectiveUnit} onValueChange={pickUnit}>
                    <SelectTrigger><SelectValue placeholder="Select a course & year" /></SelectTrigger>
                    <SelectContent>
                      {incharges.map((i) => (
                        <SelectItem key={i.id} value={unitKey(i)}>
                          {i.courseName} · {i.departmentName} · {ordinalYear(Number(i.year))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Section</Label>
                  <Select
                    value={sectionId}
                    onValueChange={(v) => { setSectionId(v); setLoaded(null); }}
                    disabled={!effectiveUnit || isLoadingSections || sections.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingSections ? "Loading sections…" : effectiveUnit && sections.length === 0 ? "No sections" : "Select a section"} />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name} · {s.studentCount ?? 0} students</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col justify-end">
                  <Button onClick={handleLoad} disabled={!sectionId}>
                    <Search className="mr-2 h-4 w-4" />{loaded ? "Reload Timetable" : "Load Timetable"}
                  </Button>
                </div>
              </div>
              {selected && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`${basePath}/${selected.courseId}/${selected.year}/teaching-assignments`}>
                      <ClipboardList className="mr-1.5 h-3.5 w-3.5" />Teaching Assignments
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {loaded ? (
            <TimetableGridEditor
              key={`${loaded.courseId}_${loaded.year}_${loaded.sectionId}`}
              courseId={loaded.courseId}
              year={loaded.year}
              sectionId={loaded.sectionId}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 h-5 w-5 opacity-50" />
              Pick a course & year and a section above, then press Load Timetable.
            </div>
          )}
        </>
      )}
    </div>
  );
}
