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
import { ExamMarksCategoriesCard } from "@/components/exams/ExamMarksCategoriesCard";
import { MidPaperTemplateCard } from "@/components/exams/MidPaperTemplateCard";
import { MidPaperPatternCard } from "@/components/exams/MidPaperPatternCard";
import { MidSubjectSplitsCard } from "@/components/exams/MidSubjectSplitsCard";
import { BloomLevelsCard } from "@/components/exams/BloomLevelsCard";
import { cn } from "@/lib/utils";
import type { ExamMidSettings, MidAssignment, MidOutcomeSwitches, MidPreparation } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { ALL_OUTCOMES_ON, outcomeSwitches } from "@/lib/midBank/outcomeSwitches";

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
      {tab === "marks" ? <div className="space-y-6"><ExamConfigurationPanel embedded /><ExamMarksCategoriesCard /></div> : tab === "paper" ? <PaperTab /> : <MidSettings />}
    </div>
  );
}

/** Question paper tab: the paper pattern when the college prepares question papers, else the bank paper template. */
function PaperTab() {
  const [mode, setMode] = useState<MidPreparation | null>(null);
  useEffect(() => {
    fetch("/api/college/exam-mid-settings").then((r) => r.json() as Promise<{ settings?: ExamMidSettings }>)
      .then((d) => setMode(d.settings?.midPreparation === "PAPERS" ? "PAPERS" : "BANK")).catch(() => setMode("BANK"));
  }, []);
  if (!mode) return <div className="h-32 bg-muted animate-pulse rounded-lg" />;
  return mode === "PAPERS" ? <MidPaperPatternCard /> : <MidPaperTemplateCard />;
}

function MidSettings() {
  const [settings, setSettings] = useState<ExamMidSettings | null>(null);
  const [midCount, setMidCount] = useState("2");
  const [preparation, setPreparation] = useState<MidPreparation>("BANK");
  const [assignment, setAssignment] = useState<MidAssignment>("SELF");
  const [outcomes, setOutcomes] = useState<MidOutcomeSwitches>(ALL_OUTCOMES_ON);
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
          setPreparation(data.settings.midPreparation === "PAPERS" ? "PAPERS" : "BANK");
          setAssignment(data.settings.midAssignment === "HOD" ? "HOD" : "SELF");
          setOutcomes(outcomeSwitches(data.settings.outcomes));
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
        body: JSON.stringify({ midCount: count, midPreparation: preparation, midAssignment: assignment, outcomes }),
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How faculty prepare a Mid</CardTitle>
          <CardDescription>For the whole college. It can&apos;t change while faculty are preparing for an open deadline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {([
              ["BANK", "Question bank", "Faculty build a bank (10 questions per unit); the question paper is picked from the approved bank."],
              ["PAPERS", "Question papers", "Faculty write the number of question papers set in the paper pattern; the Exam Cell picks the one used."],
            ] as const).map(([v, label, hint]) => (
              <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", preparation === v && "border-primary bg-primary/5")}>
                <input type="radio" name="midPreparation" className="mt-1" checked={preparation === v} onChange={() => setPreparation(v)} />
                <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Who prepares</p>
            {([
              ["SELF", "Every faculty member teaching the subject", "When the Exam Cell sets the deadline, everyone teaching a subject is told and starts their own, for the sections they pick."],
              ["HOD", "The subject's HOD assigns the setters", "The deadline goes to each subject's HOD (its Subject Department, else the branch HOD), who assigns one or more faculty - per branch, or one paper for all branches. Only they prepare it; others teaching it can view it and give suggestions."],
            ] as const).map(([v, label, hint]) => (
              <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", assignment === v && "border-primary bg-primary/5")}>
                <input type="radio" name="midAssignment" className="mt-1" checked={assignment === v} onChange={() => setAssignment(v)} />
                <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Questions carry</p>
            {([
              ["cos", "Course Outcomes (CO)", "Units and COs are set up per subject; each question names its COs."],
              ["poMapping", "CO-PO / PSO mapping", "Each CO is mapped to POs / PSOs (needs Course Outcomes)."],
              ["bloom", "Bloom's levels", "Each question names its level - which levels, and how many a bank unit needs, are set in the Bloom's levels card below."],
            ] as const).map(([k, label, hint]) => (
              <label key={k} className="flex items-start gap-3 text-sm">
                <Checkbox className="mt-0.5" checked={outcomes[k]} disabled={k === "poMapping" && !outcomes.cos}
                  onCheckedChange={(c) => setOutcomes((o) => outcomeSwitches({ ...o, [k]: c === true, ...(k === "cos" && c !== true ? { poMapping: false } : {}) }))} />
                <span><span className="block font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">A bank or paper already started keeps what it started with.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => void handleSave()} loading={isSaving}>
          Save Settings
        </Button>
      </div>

      {/* The college's Bloom's levels (names, per-unit minimums for banks). */}
      {(settings?.outcomes?.bloom ?? true) && <BloomLevelsCard bank={settings?.midPreparation !== "PAPERS"} />}

      {/* Which units each Mid covers: the bank rules, or (question papers) only the units - for per-unit paper parts. */}
      <MidBankRulesCard midCount={settings?.midCount ?? Number(midCount)} papers={settings?.midPreparation === "PAPERS"} />
      <MidSubjectSplitsCard midCount={settings?.midCount ?? Number(midCount)} />
    </div>
  );
}
