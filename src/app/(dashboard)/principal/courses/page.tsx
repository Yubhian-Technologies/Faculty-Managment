"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { CourseCatalogSettingsCard } from "@/components/academics/CourseCatalogSettingsCard";
import { DepartmentsPanel } from "@/components/academics/DepartmentsPanel";
import { SectionsPanel } from "@/components/academics/SectionsPanel";

const TABS = [
  { key: "courses", label: "Courses" },
  { key: "departments", label: "Departments" },
  { key: "sections", label: "Sections" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// One page for the whole academic structure. The active toggle lives in
// `?tab=` so the old /principal/departments and /principal/sections links (and
// the Back links on their detail pages) land on the right toggle.
function CoursesTabs() {
  const router = useRouter();
  const param = useSearchParams().get("tab");
  const active: TabKey = TABS.some((t) => t.key === param) ? (param as TabKey) : "courses";

  return (
    <div className="space-y-6">
      <div role="tablist" className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            onClick={() => router.replace(`/principal/courses?tab=${t.key}`, { scroll: false })}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              active === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === "courses" && (
        <div className="space-y-6">
          <PageHeader title="Courses" />
          <CourseCatalogSettingsCard showDepartments />
        </div>
      )}
      {active === "departments" && <DepartmentsPanel />}
      {active === "sections" && <SectionsPanel />}
    </div>
  );
}

export default function CoursesPage() {
  return (
    <Suspense fallback={null}>
      <CoursesTabs />
    </Suspense>
  );
}
