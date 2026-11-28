"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";
import { ChangeoverDates } from "./ChangeoverDates";

// Academics > Semester Changeover (Principal / VP, College Office): the end of a semester in one place - set the
// class-work end date for a whole year, review who is detained (Student Review: HODs prepare, Principal / Office
// confirm), and see whether the next semester is ready while the finished one's marks are closed (Readiness).
// Plan: ~/.claude/plans/delightful-plotting-volcano.md (Semester Changeover).

const TABS = [{ key: "dates", label: "Class-Work End Date" }] as const;
type Tab = (typeof TABS)[number]["key"];

export function SemesterChangeover() {
  const role = useAuthStore((s) => s.user?.role);
  const [tab, setTab] = useState<Tab>("dates");
  const canEdit = role === "PRINCIPAL" || role === "COLLEGE_OFFICE" || role === "SUPER_ADMIN";
  return (
    <div className="space-y-6">
      <PageHeader title="Semester Changeover" description="End a semester for a whole year: the class-work end date, detained students, and whether the next semester is ready." />
      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors", tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</button>
        ))}
      </div>
      {tab === "dates" && <ChangeoverDates canEdit={canEdit} />}
    </div>
  );
}
