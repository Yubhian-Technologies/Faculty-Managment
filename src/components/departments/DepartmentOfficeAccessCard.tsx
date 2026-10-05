"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import type { OfficeModuleGroup } from "@/lib/departments/officeAccess";

// The HOD picks which of their modules the Department Office head can use.
// Until they save, the office head has the HOD's whole sidebar (as before).
interface Payload { department: string; hrefs: string[] | null; catalog: OfficeModuleGroup[] }

const KEY = ["hod-department-office-access"];

export function DepartmentOfficeAccessCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch("/api/college/department-office/access", { cache: "no-store" });
      const json = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      return json;
    },
  });
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  if (isLoading || !data) return null;
  const all = data.catalog.flatMap((g) => g.items.map((i) => i.href));
  // Never configured = everything is on.
  const selected = draft ?? new Set(data.hrefs ?? all);

  const toggle = (hrefs: string[], on: boolean) => {
    const next = new Set(selected);
    hrefs.forEach((h) => (on ? next.add(h) : next.delete(h)));
    setDraft(next);
  };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/department-office/access", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hrefs: Array.from(selected) }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setDraft(null);
      await qc.invalidateQueries({ queryKey: KEY });
      toast({ variant: "success", title: "Department Office modules saved", description: "Applies the next time they open or refresh the app." });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Modules the office head can use</CardTitle>
        <CardDescription>
          {data.hrefs === null ? "Not configured yet - the office head currently sees everything you do. " : ""}
          Their dashboard, profile, leave and attendance are always available.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.catalog.map((g) => {
          const hrefs = g.items.map((i) => i.href);
          const allOn = hrefs.every((h) => selected.has(h));
          return (
            <div key={g.name} className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <Checkbox checked={allOn} onCheckedChange={(c) => toggle(hrefs, c === true)} aria-label={`All of ${g.name}`} />
                {g.name}
              </label>
              <div className="grid gap-2 pl-6 sm:grid-cols-2">
                {g.items.map((i) => (
                  <label key={i.href} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={selected.has(i.href)} onCheckedChange={(c) => toggle([i.href], c === true)} aria-label={i.label} />
                    {i.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || (!draft && data.hrefs !== null)}>
            <Save className="h-4 w-4 mr-1.5" />{saving ? "Saving…" : "Save"}
          </Button>
          <span className="text-xs text-muted-foreground">{selected.size} of {all.length} modules allowed</span>
        </div>
      </CardContent>
    </Card>
  );
}
