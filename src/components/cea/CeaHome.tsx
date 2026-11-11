"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { CeaPlans } from "./CeaPlans";
import { CeaSections } from "./CeaSections";

// HOD / Exam Cell > CEA: the plans (per subject) and the marks by section.
export function CeaHome({ title, description }: { title: string; description: string }) {
  const [tab, setTab] = useState<"plans" | "marks">("plans");
  const tabs = (
    <div role="tablist" className="flex gap-2 border-b">
      {([["plans", "Plans"], ["marks", "Marks by section"]] as const).map(([id, label]) => (
        <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>
      ))}
    </div>
  );
  return tab === "plans" ? <CeaPlans title={title} description={description} tabs={tabs} /> : <div className="max-w-6xl space-y-6"><PageHeader title={title} description={description} className="mb-0" />{tabs}<CeaSections /></div>;
}

