"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { financialYearContaining, type FinancialYearItem } from "@/lib/college/financialYear";

// The college's financial year periods, added by the Principal / VP / College
// Admin with an explicit start and end date (so the duration isn't assumed to
// be April-March). Finance picks from this list when opening a budget cycle.
export function FinancialYearSettingsCard() {
  const [years, setYears] = useState<FinancialYearItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/college/financial-years");
      const json = await res.json() as { financialYears?: FinancialYearItem[] };
      setYears(json.financialYears ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load financial years" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  async function handleAdd() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/financial-years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to add the financial year");
      toast({ variant: "success", title: "Financial year added" });
      setStartDate("");
      setEndDate("");
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to add" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/college/financial-years?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to remove");
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to remove" });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const current = financialYearContaining(years, today);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />Financial Year
        </CardTitle>
        <CardDescription>
          Set each financial year&rsquo;s start and end date. Budget cycles pick from this list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="h-9 w-48 rounded-md bg-muted animate-pulse" />
        ) : (
          <>
            {years.length === 0 ? (
              <p className="text-sm text-muted-foreground">No financial year added yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {years.map((y) => (
                  <li key={y.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{y.label}</span>
                      <span className="text-muted-foreground">{formatDate(new Date(y.startDate))} – {formatDate(new Date(y.endDate))}</span>
                      {current?.id === y.id && <Badge variant="secondary">Current</Badge>}
                    </span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Remove ${y.label}`} onClick={() => void handleDelete(y.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <Button onClick={() => void handleAdd()} loading={isSaving} disabled={!startDate || !endDate}>
                Add Financial Year
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
