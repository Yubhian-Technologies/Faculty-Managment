"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { formatDate, stripLeadingZeros } from "@/lib/utils";
import { MidBankRulesCard } from "@/components/exams/MidBankRulesCard";
import { ExamConfigurationPanel } from "@/components/exams/ExamConfigurationPanel";
import { MidPaperTemplateCard } from "@/components/exams/MidPaperTemplateCard";
import { cn } from "@/lib/utils";
import type { ExamMidSettings } from "@/types";

// Exam Cell > Mid Exams > Mid Configuration, two tabs: "Mid exams & question
// bank" (how many Mids the college runs, the question bank rules per course) and
// "Marks" (Internal / External marks per course, year, branch - the former
// Exam Configuration page; /exam-cell/configure redirects to it).
export default function MidConfigurationPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
      <MidConfigurationTabs />
    </Suspense>
  );
}

function MidConfigurationTabs() {
  const sp = useSearchParams();
  const tab = sp.get("tab") === "marks" ? "marks" : sp.get("tab") === "paper" ? "paper" : "mid";
  return (
    <div className={cn("space-y-6", tab === "mid" && "max-w-2xl", tab === "paper" && "max-w-4xl")}>
      <PageHeader title="Mid Configuration" description="How many Mid exams the college runs, the question bank rules, the question paper template, and the Internal / External marks." />
      <nav className="inline-flex flex-wrap rounded-xl border bg-muted/40 p-1 text-sm" aria-label="Mid Configuration sections">
        {([["mid", "Mid exams & question bank"], ["paper", "Question paper"], ["marks", "Marks (Internal / External)"]] as const).map(([k, label]) => (
          <Link key={k} href={k === "mid" ? "/exam-cell/mid-configuration" : `/exam-cell/mid-configuration?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={cn("rounded-lg px-3.5 py-1.5 font-medium", tab === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</Link>
        ))}
      </nav>
      {tab === "marks" ? <ExamConfigurationPanel embedded /> : tab === "paper" ? <MidPaperTemplateCard /> : <MidSettings />}
    </div>
  );
}

function MidSettings() {
  const [settings, setSettings] = useState<ExamMidSettings | null>(null);
  const [midCount, setMidCount] = useState("2");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/exam-mid-settings");
        const data = (await res.json()) as { settings?: ExamMidSettings };
        if (data.settings) {
          setSettings(data.settings);
          if (data.settings.midCount > 0) setMidCount(String(data.settings.midCount));
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load settings" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    const count = Number(midCount);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      toast({ variant: "destructive", title: "Enter a whole number between 1 and 10" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/exam-mid-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ midCount: count }),
      });
      const data = (await res.json()) as { settings?: ExamMidSettings; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSettings(data.settings ?? null);
      toast({ variant: "success", title: "Settings saved" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <div className="h-32 bg-muted animate-pulse rounded-lg" />;
  }

  return (
    <div className="space-y-6">

      {!settings?.midCount && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          The number of Mid exams isn&rsquo;t saved yet - press Save Settings. Until then Mid Timings &amp; Dates can&rsquo;t publish timings.
        </div>
      )}

      {settings?.updatedAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border bg-muted/40 px-3 py-2">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Last updated {formatDate(settings.updatedAt)} by {settings.updatedByName ?? "Exam Cell"}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mid Exams</CardTitle>
          <CardDescription>
            How many mid-semester exams this college runs - used by the Mid Timings &amp; Dates tab
            to offer Mid 1..N when publishing a schedule.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="midCount">Mid</Label>
            <Input
              id="midCount"
              type="number"
              min={1}
              max={10}
              value={midCount}
              onChange={(e) => setMidCount(stripLeadingZeros(e.target.value))}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => void handleSave()} loading={isSaving}>
          Save Settings
        </Button>
      </div>

      <MidBankRulesCard midCount={settings?.midCount ?? Number(midCount)} />
    </div>
  );
}
