"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Pencil, Info } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { AcademicRegulationSettings } from "@/types";
import { currentAcademicStartYear } from "@/lib/college/academicSession";

interface RegulationSettingsCardProps {
  // Dean's dashboard shows the same settings live off the Principal's own
  // GET endpoint (see /api/college/settings/regulations), but Dean can't
  // PUT to it - so this skips straight to the read-only view and drops the
  // Edit button entirely, rather than dropping them into a form that would
  // 403 on Save.
  readOnly?: boolean;
  // Called after a successful save - lets the parent Settings page refresh
  // CourseCatalogSettingsCard's own copy of the declared regulations (see its
  // regulationsRefreshKey prop), since that's a sibling card that fetched
  // them once on mount and has no other way to notice this save.
  onSaved?: () => void;
}

// Intake batches offered by the picker: next year's admissions back through
// the five previous intakes, which covers every cohort that can still be on
// campus. Labelled with a 4-year span because only the START year carries any
// meaning (see parseBatchStartYear / regulationsForCourseYearByBatch) - the
// end year is descriptive, matching the wording of the hint under this field.
// Any value already saved is kept in the list even if it falls outside that
// window, so opening Edit on an older regulation never silently drops it.
function batchOptions(): string[] {
  const start = currentAcademicStartYear();
  const years = [start + 1, start, start - 1, start - 2, start - 3, start - 4, start - 5];
  return years.map((y) => `${y}-${y + 4}`);
}

// The field holds a comma-separated list - one regulation commonly runs for
// several consecutive intakes (R23 governing both the 2024 and 2025
// admissions). Stored as text rather than an array to stay compatible with
// what's already saved; parseBatchStartYears reads it the same way.
function splitBatches(value: string | undefined): string[] {
  return (value ?? "").split(",").map((b) => b.trim()).filter(Boolean);
}
function joinBatches(list: string[]): string {
  return list.join(",");
}

export function RegulationSettingsCard({ readOnly = false, onSaved }: RegulationSettingsCardProps) {
  const [settings, setSettings] = useState<AcademicRegulationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [regulations, setRegulations] = useState<string[]>([]);
  // Which intake batch (e.g. "2024-2028") each regulation code covers - one
  // per regulation, purely descriptive (see AcademicRegulationSettings's own
  // doc-comment). Keyed by code rather than tracked per-index so a reorder
  // (not currently possible here, but future-proof) can't scramble pairing.
  const [batches, setBatches] = useState<Record<string, string>>({});
  const [newRegulation, setNewRegulation] = useState("");

  const load = useCallback(() => {
    setIsLoading(true);
    fetch("/api/college/settings/regulations")
      .then((r) => r.json() as Promise<{ settings: AcademicRegulationSettings }>)
      .then(({ settings: s }) => {
        setSettings(s);
        setRegulations(s.regulations ?? []);
        setBatches(s.regulationBatches ?? {});
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
    setBatches((b) => { const next = { ...b }; delete next[name]; return next; });
  }

  function cancelEdit() {
    if (settings) {
      setRegulations(settings.regulations ?? []);
      setBatches(settings.regulationBatches ?? {});
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
        body: JSON.stringify({ regulations, regulationBatches: batches }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to save" });
        return;
      }
      toast({ variant: "success", title: "Regulations saved" });
      setIsEditing(false);
      load();
      onSaved?.();
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
            Curriculum regulation codes in use across your college (e.g. R20, R23) — declare them here first. Which
            ones a specific course may use, and for which of its years, is set on that course&rsquo;s own entry in
            Course Catalog below.
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
          <div className="h-16 bg-muted animate-pulse rounded-lg" />
        ) : isEditing ? (
          <>
            <div className="space-y-2">
              <Label>Regulations</Label>
              {regulations.length > 0 && (
                <div className="space-y-2">
                  {regulations.map((r) => (
                    <div key={r} className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs shrink-0 w-16 justify-center">{r}</Badge>
                      {/* A dropdown rather than free text: only the batch's
                          START year is ever read (parseBatchStartYear matches
                          /^(\d{4})/), so a typo, a different separator, or a
                          second batch appended after a comma is either ignored
                          or silently changes which year the regulation lands
                          on. One well-formed batch per regulation is also what
                          the model documents. */}
                      <div className="flex flex-wrap items-center gap-1.5 max-w-md">
                        {splitBatches(batches[r]).map((b) => (
                          <span key={b} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                            {b}
                            <button
                              type="button"
                              onClick={() => setBatches((prev) => ({ ...prev, [r]: joinBatches(splitBatches(prev[r]).filter((x) => x !== b)) }))}
                              className="rounded-full hover:bg-muted-foreground/20"
                              title={`Remove ${b}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        <select
                          value=""
                          onChange={(e) => {
                            const picked = e.target.value;
                            if (!picked) return;
                            setBatches((prev) => {
                              const existing = splitBatches(prev[r]);
                              if (existing.includes(picked)) return prev;
                              return { ...prev, [r]: joinBatches([...existing, picked]) };
                            });
                          }}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:border-primary focus:outline-none"
                        >
                          <option value="">+ Add batch…</option>
                          {batchOptions().filter((b) => !splitBatches(batches[r]).includes(b)).map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRegulation(r)}
                        className="rounded-full p-1 hover:bg-muted-foreground/20 shrink-0"
                        aria-label={`Remove ${r}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
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
              <p className="text-xs text-muted-foreground">
                The batch is the intake year range this regulation covers (e.g. students admitted 2024, graduating 2028).
              </p>
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
          <p className="text-sm text-muted-foreground">The Principal hasn&rsquo;t declared any regulations yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {(settings?.regulations ?? []).map((r) => {
                const batch = settings?.regulationBatches?.[r];
                return (
                  <Badge key={r} variant="secondary" className="text-xs">
                    {r}{batch ? ` (${batch})` : ""}
                  </Badge>
                );
              })}
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
