"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { PrincipalHolidaysTabs } from "@/components/holidays/PrincipalHolidaysTabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { Holiday } from "@/types";

const DAY_NAMES: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday",
};

// The Principal decides whether the Sunday set against a bridge holiday is a
// working day. When on, students and faculty both work that Sunday and it runs
// the bridged weekday's timetable; when off, it stays an ordinary Sunday off.
export default function PrincipalHolidaysPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/college/holidays")
      .then((r) => r.json() as Promise<{ holidays: Holiday[] }>)
      .then((d) => setHolidays(d.holidays ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load holidays" }))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    void (async () => { load(); })();
  }, [load]);

  const bridges = useMemo(
    () => holidays.filter((h) => h.category === "BRIDGE" && h.compensatoryDateKey).sort((a, b) => (b.compensatoryDateKey ?? "").localeCompare(a.compensatoryDateKey ?? "")),
    [holidays]
  );

  async function setEnabled(h: Holiday, enabled: boolean) {
    setSavingId(h.id);
    try {
      const res = await fetch(`/api/college/holidays/${h.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compensatoryEnabled: enabled }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      toast({ variant: "success", title: enabled ? "Sunday is now a working day" : "Sunday stays a day off" });
      load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update" });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PrincipalHolidaysTabs active="compensatory" />
      <PageHeader
        title="Compensatory Sundays"
        description="Compensatory holidays that offer a Sunday in return. Switch one on to make that Sunday a working day for students and faculty, running the bridged day's timetable."
      />
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : bridges.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<CalendarCheck className="h-6 w-6" />}
                title="Nothing to decide"
                description="When Academics declares a compensatory holiday with a Sunday in return, it appears here."
              />
            </div>
          ) : (
            <div className="divide-y">
              {bridges.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-4 p-4 flex-wrap">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">{h.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Holiday on {formatDate(h.date)} &middot; Sunday {formatDate(h.compensatoryDateKey)} runs{" "}
                      {DAY_NAMES[h.compensatoryFollowsDay ?? ""] ?? "that day"}&rsquo;s timetable
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={h.compensatoryEnabled ? "secondary" : "outline"} className="text-xs">
                      {h.compensatoryEnabled ? "Working day" : "Day off"}
                    </Badge>
                    <Switch
                      checked={!!h.compensatoryEnabled}
                      disabled={savingId === h.id}
                      onCheckedChange={(v) => void setEnabled(h, v)}
                      aria-label={`Make ${h.compensatoryDateKey} a working day`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
