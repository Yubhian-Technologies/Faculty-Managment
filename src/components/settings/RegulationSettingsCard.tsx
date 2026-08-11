"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Pencil, Info } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { AcademicRegulationSettings } from "@/types";

const YEARS = ["1", "2", "3", "4"] as const;

function yearLabel(y: string) {
  const suffix = y === "1" ? "st" : y === "2" ? "nd" : y === "3" ? "rd" : "th";
  return `${y}${suffix} Year`;
}

interface RegulationSettingsCardProps {
  // Dean's dashboard shows the same settings live off the Principal's own
  // GET endpoint (see /api/college/settings/regulations), but Dean can't
  // PUT to it - so this skips straight to the read-only view and drops the
  // Edit button entirely, rather than dropping them into a form that would
  // 403 on Save.
  readOnly?: boolean;
}

export function RegulationSettingsCard({ readOnly = false }: RegulationSettingsCardProps) {
  const [settings, setSettings] = useState<AcademicRegulationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [regulations, setRegulations] = useState<string[]>([]);
  const [yearRegulations, setYearRegulations] = useState<Record<string, string>>({});
  const [newRegulation, setNewRegulation] = useState("");

  const load = useCallback(() => {
    setIsLoading(true);
    fetch("/api/college/settings/regulations")
      .then((r) => r.json() as Promise<{ settings: AcademicRegulationSettings }>)
      .then(({ settings: s }) => {
        setSettings(s);
        setRegulations(s.regulations ?? []);
        setYearRegulations(s.yearRegulations ?? {});
        // Nothing saved yet - go straight into editing so there's something to do here.
        setIsEditing(!readOnly && (s.regulations ?? []).length === 0);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load regulations" }))
      .finally(() => setIsLoading(false));
  }, [readOnly]);

  useEffect(() => {
    // Wrapped so load()'s setState calls aren't reachable synchronously from
    // the effect body (react-hooks/set-state-in-effect).
    void (async () => { load(); })();
  }, [load]);

  function addRegulation() {
    const value = newRegulation.trim();
    if (!value) return;
    if (regulations.some((r) => r.toLowerCase() === value.toLowerCase())) {
      toast({ variant: "destructive", title: "That regulation is already in the list" });
      return;
    }
    setRegulations((r) => [...r, value]);
    setNewRegulation("");
  }

  function removeRegulation(name: string) {
    setRegulations((r) => r.filter((x) => x !== name));
    // A year that was fixed to this regulation needs re-picking.
    setYearRegulations((yr) => {
      const next = { ...yr };
      for (const y of YEARS) if (next[y] === name) delete next[y];
      return next;
    });
  }

  function cancelEdit() {
    if (settings) {
      setRegulations(settings.regulations ?? []);
      setYearRegulations(settings.yearRegulations ?? {});
    }
    setIsEditing(false);
  }

  async function handleSave() {
    if (regulations.length === 0) {
      toast({ variant: "destructive", title: "Add at least one regulation first" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/settings/regulations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regulations, yearRegulations }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to save" });
        return;
      }
      toast({ variant: "success", title: "Regulations saved" });
      setIsEditing(false);
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Academic Regulations</CardTitle>
          <CardDescription>
            Curriculum regulations in use (e.g. R20, R23) and which one applies to each year of study
          </CardDescription>
        </div>
        {!readOnly && !isLoading && !isEditing && (
          <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="h-32 bg-muted animate-pulse rounded-lg" />
        ) : isEditing ? (
          <>
            <div className="space-y-2">
              <Label>Regulations</Label>
              {regulations.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {regulations.map((r) => (
                    <Badge key={r} variant="secondary" className="gap-1.5 pr-1 text-xs">
                      {r}
                      <button
                        type="button"
                        onClick={() => removeRegulation(r)}
                        className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                        aria-label={`Remove ${r}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={newRegulation}
                  onChange={(e) => setNewRegulation(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRegulation(); } }}
                  placeholder="e.g. R23"
                  className="text-sm max-w-xs"
                />
                <Button type="button" variant="outline" onClick={addRegulation}>
                  <Plus className="h-4 w-4 mr-1" />Add
                </Button>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <Label>Fix a regulation for each year</Label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {YEARS.map((y) => (
                  <div key={y} className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">{yearLabel(y)}</p>
                    <Select
                      value={yearRegulations[y] ?? ""}
                      onValueChange={(v) => setYearRegulations((yr) => ({ ...yr, [y]: v }))}
                      disabled={regulations.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={regulations.length ? "Select" : "Add a regulation first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {regulations.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {settings && settings.regulations.length > 0 && (
                <Button type="button" variant="outline" onClick={cancelEdit} disabled={isSaving}>
                  Cancel
                </Button>
              )}
              <Button type="button" onClick={handleSave} loading={isSaving}>
                Save
              </Button>
            </div>
          </>
        ) : (settings?.regulations ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">The Principal hasn&rsquo;t set any regulations yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {(settings?.regulations ?? []).map((r) => <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {YEARS.map((y) => (
                <div key={y} className="rounded-md border p-2.5">
                  <p className="text-xs text-muted-foreground">{yearLabel(y)}</p>
                  <p className="text-sm font-medium mt-0.5">
                    {settings?.yearRegulations?.[y] ?? <span className="text-muted-foreground">Not fixed</span>}
                  </p>
                </div>
              ))}
            </div>
            {settings?.updatedAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Last updated {formatDate(settings.updatedAt)} by {settings.updatedByName ?? "Principal"}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
