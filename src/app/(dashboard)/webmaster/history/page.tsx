"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmailRequestQueue } from "../EmailRequestQueue";

const TABS = [
  { key: "COMPLETED", label: "Completed" },
  { key: "CANCELLED", label: "Cancelled" },
] as const;

export default function WebmasterHistoryPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("COMPLETED");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request History"
        description="Resolved official-email requests for your college"
      />

      <div className="flex gap-2 border-b">
        {TABS.map((t) => (
          <Button
            key={t.key}
            variant="ghost"
            size="sm"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-none border-b-2 border-transparent",
              tab === t.key && "border-primary text-primary"
            )}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <EmailRequestQueue
        status={tab}
        emptyTitle={tab === "COMPLETED" ? "No emails created yet" : "No cancelled requests"}
        emptyDescription={
          tab === "COMPLETED"
            ? "Requests you've fulfilled will appear here."
            : "Requests the requesting office withdrew will appear here."
        }
      />
    </div>
  );
}
