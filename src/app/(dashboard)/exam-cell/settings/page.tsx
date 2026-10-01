"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { formatDate, stripLeadingZeros } from "@/lib/utils";
import type { ExamMidSettings } from "@/types";

export default function ExamCellSettingsPage() {
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
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader title="Settings" description="Loading..." />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Settings" description="Exam Cell configuration" />

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
    </div>
  );
}
