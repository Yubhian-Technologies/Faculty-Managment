"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, CalendarDays, GraduationCap, Layers, UserCog, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import type { Course, Section } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function ClassLeaderDashboardPage() {
  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/class-leader/timetable")
      .then((r) => r.json() as Promise<{ course?: Course; section?: Section; error?: string }>)
      .then((d) => {
        setCourse(d.course ?? null);
        setSection(d.section ?? null);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load your section" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class Leader Dashboard"
        description={section ? `${section.department ? `${section.department} · ` : ""}${course ? `${course.name} · ` : ""}${ordinalYear(section.year)} · Section ${section.name}` : "Your section"}
      />

      {isLoading ? (
        <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !section ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No section is linked to your login yet. Ask College Office to link one.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="font-medium">{section.department || "-"}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <Layers className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Section</p>
                <p className="font-medium">{section.name}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <GraduationCap className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Course &amp; Year</p>
                <p className="font-medium">{course ? `${course.name} · ${ordinalYear(section.year)}` : ordinalYear(section.year)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Batch</p>
                <p className="font-medium">{section.batch || "-"}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <UserCog className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Faculty Incharge</p>
                <p className="font-medium">{section.facultyInchargeName || "Not assigned"}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {section && (
        <Button asChild>
          <Link href="/class-leader/timetable">
            <CalendarDays className="h-4 w-4 mr-2" />View Timetable
          </Link>
        </Button>
      )}
    </div>
  );
}
