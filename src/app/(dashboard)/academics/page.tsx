"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import { ROLE_LABELS } from "@/types";
import { Library, ArrowRight, BookOpen, ShieldCheck, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { HealthIssue } from "@/lib/subjects/health";

const QUICK_ACTIONS = [
  {
    href: "/academics/course-structure",
    icon: Library,
    title: "Curriculum",
    description: "One flow: add a course's subjects for a regulation, assign them to a department's semester by typing their codes, and keep the regulation document and syllabus.",
  },
] as const;

export default function AcademicsDashboard() {
  const user = useAuthStore((s) => s.user);
  const { nameFor } = useFacultyDisplayNames();
  const router = useRouter();
  const [courseCount, setCourseCount] = useState<number | null>(null);

  const [issues, setIssues] = useState<HealthIssue[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");

  useEffect(() => {
    // The stat chip: a count aggregate on the server, not the whole course list.
    fetch("/api/college/academics/overview")
      .then((r) => r.json() as Promise<{ activeCourses?: number }>)
      .then((d) => setCourseCount(typeof d.activeCourses === "number" ? d.activeCourses : null))
      .catch(() => setCourseCount(null));
  }, []);

  async function runCheck() {
    setChecking(true);
    setCheckError("");
    try {
      const res = await fetch("/api/college/academics/overview?check=1");
      const body = (await res.json()) as { issues?: HealthIssue[]; error?: string };
      if (!res.ok || !body.issues) throw new Error(body.error ?? "The check failed.");
      setIssues(body.issues);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "The check failed.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Welcome header */}
      <div>
        <PageHeader
          title={`Hello, ${user ? nameFor("dashboardName", { uid: user.uid }, user.name) : "there"}`}
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

      <section aria-labelledby="health-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="health-heading" className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Data check</h2>
          <Button variant="outline" size="sm" onClick={() => void runCheck()} loading={checking}>
            <ShieldCheck className="mr-1.5 h-4 w-4" />{issues ? "Check again" : "Run check"}
          </Button>
        </div>
        <Card>
          <CardContent className="space-y-3 p-4 text-sm">
            {checkError && <p className="text-red-600">{checkError}</p>}
            {!issues && !checkError && <p className="text-muted-foreground">Looks for duplicate subject codes or names, courses with no regulation, years with no semesters, and semester subjects that no longer match their master. It reads your curriculum once, only when you ask.</p>}
            {issues && issues.length === 0 && <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4" />Nothing to fix. The curriculum is consistent.</p>}
            {issues?.map((issue) => (
              <details key={issue.code} className="rounded-md border p-3" open={issue.severity === "error"}>
                <summary className="flex cursor-pointer items-start gap-2 font-medium">
                  {issue.severity === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${issue.severity === "error" ? "text-red-600" : "text-amber-600"}`} />}
                  <span>{issue.title} <span className="text-muted-foreground">({issue.count})</span></span>
                </summary>
                <ul className="mt-2 list-disc space-y-0.5 pl-9 text-xs text-muted-foreground">
                  {issue.items.map((it) => <li key={it}>{it}</li>)}
                  {issue.count > issue.items.length && <li>…and {issue.count - issue.items.length} more</li>}
                </ul>
              </details>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
