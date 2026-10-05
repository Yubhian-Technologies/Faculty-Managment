"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { ROLE_LABELS } from "@/types";
import { Library, BookOpen, FileText, Tags, ArrowRight, ListChecks } from "lucide-react";

const QUICK_ACTIONS = [
  {
    href: "/academics/regulation",
    icon: FileText,
    title: "Regulation",
    description: "Manage curriculum regulations for each course and upload their reference documents.",
  },
  {
    href: "/academics/course-structure",
    icon: Library,
    title: "Course Structure",
    description: "Import a course's subjects from a spreadsheet and assign them to a department's semesters.",
  },
  {
    href: "/academics/subjects",
    icon: ListChecks,
    title: "Subjects",
    description: "View, add, edit and delete the subjects for each course and regulation.",
  },
  {
    href: "/academics/categories",
    icon: Tags,
    title: "Categories",
    description: "Define subject categories as a short code and its full form, for use in Course Structure files.",
  },
  {
    href: "/academics/syllabus",
    icon: BookOpen,
    title: "Syllabus",
    description: "Upload a department's syllabus document for a course under a regulation.",
  },
] as const;

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
          {QUICK_ACTIONS.map((action) => (
            <Card
              key={action.href}
              className="group cursor-pointer transition-shadow hover:shadow-md"
              role="link"
              tabIndex={0}
              onClick={() => router.push(action.href)}
              onKeyDown={(e) => e.key === "Enter" && router.push(action.href)}
              aria-label={`Go to ${action.title}`}
            >
              <CardHeader className="pb-3">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <action.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <CardTitle className="text-base">{action.title}</CardTitle>
                <CardDescription>{action.description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button variant="ghost" size="sm" className="px-0 text-primary gap-1 group-hover:gap-2 transition-all" tabIndex={-1}>
                  Open {action.title} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
