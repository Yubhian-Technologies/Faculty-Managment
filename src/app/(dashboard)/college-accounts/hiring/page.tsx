"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { CollegeAccountsHiringBoard } from "./CollegeAccountsHiringBoard";

export default function CollegeAccountsHiringPage() {
  const [scope, setScope] = useState<"active" | "closed">("active");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Journey"
        description={
          scope === "active"
            ? "View-only — every hiring request from raise to faculty account creation, grouped by department"
            : "Completed and rejected hiring requests, grouped by department"
        }
      />

      <div className="flex gap-2">
        <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>
          Active
        </Button>
        <Button size="sm" variant={scope === "closed" ? "default" : "outline"} onClick={() => setScope("closed")}>
          Past Hirings
        </Button>
      </div>

      <CollegeAccountsHiringBoard scope={scope} />
    </div>
  );
}
