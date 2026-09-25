"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/useToast";

interface Settings {
  enabled: boolean;
  cutoffTime: string;
}

// Self-contained settings card (loads + saves on its own, same convention
// as the other *SettingsCard components on this page) for the scheduled
// "not posted attendance" reminder: once the configured cutoff time passes
// each day, every faculty with a period still missing a submitted
// attendance session gets one notification (see
// api/cron/attendance-not-posted/route.ts, which actually runs the check).
export function AttendanceNotPostedSettingsCard() {
  const [settings, setSettings] = useState<Settings>({ enabled: false, cutoffTime: "18:00" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/attendance-not-posted-settings");
      const json = await res.json() as { settings?: Settings };
      if (json.settings) setSettings({ enabled: json.settings.enabled, cutoffTime: json.settings.cutoffTime });
    } catch {
      toast({ variant: "destructive", title: "Failed to load reminder settings" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/attendance-not-posted-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      toast({ variant: "success", title: "Saved" });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><BellRing className="h-4 w-4" />Attendance Not-Posted Reminder</CardTitle>
        <CardDescription>
          Once this time passes each day, any faculty with a class period still missing submitted attendance gets a
          notification. Checked automatically on a schedule - nothing to run manually.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="h-16 rounded-lg border bg-muted/30 animate-pulse" />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))} id="not-posted-enabled" />
              <Label htmlFor="not-posted-enabled" className="cursor-pointer">Enable reminder</Label>
            </div>
            <div className="space-y-2 max-w-xs">
              <Label htmlFor="not-posted-cutoff">Cutoff time (IST)</Label>
              <Input
                id="not-posted-cutoff"
                type="time"
                value={settings.cutoffTime}
                onChange={(e) => setSettings((s) => ({ ...s, cutoffTime: e.target.value }))}
                disabled={!settings.enabled}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void handleSave()} loading={isSaving}>Save</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
