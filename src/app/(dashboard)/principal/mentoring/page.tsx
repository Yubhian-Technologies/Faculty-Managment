"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { StudentFinder } from "@/components/mentoring/StudentFinder";
import type { MentoringOverview } from "@/types/mentoring";

// Principal and Vice-Principal: how mentoring is going in their college. Counts only - the
// students' notes, concerns and referrals are never shown here.

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function PrincipalMentoringPage() {
  const [data, setData] = useState<MentoringOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/college/mentoring/overview")
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { overview?: MentoringOverview; error?: string };
        if (!res.ok || !body.overview) throw new Error(body.error || "Could not load the summary");
        if (!cancelled) setData(body.overview);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="text-sm text-muted-foreground py-6">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground py-6">Loading…</p>;

  const { totals, categories, actions, escalations, weekly } = data;
  const maxCat = Math.max(1, ...categories.map((c) => c.meetings));
  const weeks = weekly.present + weekly.absent + weekly.excused;

  return (
    <div className="space-y-5">
      <PageHeader title="Student Mentoring" description="Mentoring in your college: the numbers below, and any student's Mentoring Record (read-only) from the search." />

      <StudentFinder byDepartment={data.byDepartment} byMentor={data.byMentor} />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Students" value={totals.students} />
        <Tile label="Have a mentor" value={totals.mentored} hint={`${totals.unmentored} without one`} />
        <Tile label="Met recently" value={`${totals.metRecently} of ${totals.mentored}`} hint={`Mentored students with a meeting in the last ${data.recentDays} days`} />
        <Tile label="Never met" value={totals.neverMet} hint="Mentored students with no meeting recorded" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-5 space-y-2">
            <h2 className="text-base font-semibold">Follow-ups</h2>
            <p className="text-sm">Open <strong>{actions.open}</strong> · In progress <strong>{actions.inProgress}</strong> · Done <strong>{actions.done}</strong></p>
            <p className="text-xs text-muted-foreground">{actions.overdue} open item{actions.overdue === 1 ? "" : "s"} past the due date</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 space-y-2">
            <h2 className="text-base font-semibold">Referral / escalation status</h2>
            <p className="text-sm">Open <strong>{escalations.open}</strong> · Under review <strong>{escalations.underReview}</strong> · Resolved <strong>{escalations.resolved}</strong></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 space-y-2">
            <h2 className="text-base font-semibold">Weekly check-ins (last 4 weeks)</h2>
            <p className="text-sm">
              {weeks === 0 ? "None recorded" : <>Present <strong>{weekly.present}</strong> · Absent <strong>{weekly.absent}</strong> · Excused <strong>{weekly.excused}</strong></>}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-3">
          <h2 className="text-base font-semibold">What mentors discuss</h2>
          <p className="text-xs text-muted-foreground">{totals.meetings} meeting{totals.meetings === 1 ? "" : "s"} recorded; a meeting counts under every category it covered.</p>
          <ul className="space-y-2">
            {categories.map((c) => (
              <li key={c.value} className="grid grid-cols-[minmax(0,12rem)_1fr_2.5rem] items-center gap-3 text-sm">
                <span className="truncate">{c.label}</span>
                <span className="h-2 rounded-full bg-muted overflow-hidden" aria-hidden>
                  <span className="block h-full bg-primary" style={{ width: `${(c.meetings / maxCat) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">{c.meetings}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

    </div>
  );
}
