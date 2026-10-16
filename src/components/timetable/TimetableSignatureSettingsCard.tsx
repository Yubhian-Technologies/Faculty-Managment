"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { Plus, Trash2 } from "lucide-react";
import { parseDesignations, MAX_SIGNATURE_GROUPS, MAX_DESIGNATIONS_PER_GROUP, type SignatureDesignation, type SignatureGroup } from "@/lib/timetable/signatureAuthority";

// colleges/{collegeId}/settings/timetableSignatures - see
// src/app/api/college/settings/timetable-signatures/route.ts. A group is one line
// of designations joined with "+"; every ticked group is printed as a row of
// signature blocks under the college's timetables (PDF, print, Excel).
export function TimetableSignatureSettingsCard() {
  const queryClient = useQueryClient();
  const [groups, setGroups] = useState<SignatureGroup[]>([]);
  const [groupName, setGroupName] = useState("");
  // Designation text being typed, per group id.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/college/settings/timetable-signatures", { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ groups?: SignatureGroup[] }>)
      .then((d) => setGroups(d.groups ?? []))
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        toast({ variant: "destructive", title: "Failed to load signature authority" });
      })
      .finally(() => setIsLoading(false));
    return () => ctrl.abort();
  }, []);

  function addGroup() {
    if (groups.length >= MAX_SIGNATURE_GROUPS) {
      toast({ variant: "destructive", title: `At most ${MAX_SIGNATURE_GROUPS} groups` });
      return;
    }
    const name = groupName.replace(/\s+/g, " ").trim() || `Group ${groups.length + 1}`;
    setGroups((prev) => [...prev, { id: `g_${Date.now().toString(36)}`, name, designations: [] }]);
    setGroupName("");
  }

  function setDesignations(id: string, list: SignatureDesignation[]) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, designations: list } : g)));
  }

  // "HOD + Principal" typed into a group adds both designations at once.
  function addDesignations(g: SignatureGroup) {
    const typed = parseDesignations(drafts[g.id] ?? "");
    const have = new Set(g.designations.map((d) => d.label.toLowerCase()));
    const added = typed.filter((label, i) => !have.has(label.toLowerCase()) && typed.findIndex((t) => t.toLowerCase() === label.toLowerCase()) === i);
    if (added.length === 0) return;
    if (g.designations.length + added.length > MAX_DESIGNATIONS_PER_GROUP) {
      toast({ variant: "destructive", title: `At most ${MAX_DESIGNATIONS_PER_GROUP} designations in a group` });
      return;
    }
    setDesignations(g.id, [...g.designations, ...added.map((label) => ({ label, selected: true }))]);
    setDrafts((prev) => ({ ...prev, [g.id]: "" }));
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/settings/timetable-signatures", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; groups?: SignatureGroup[] };
      if (!res.ok) throw new Error(d.error || "Failed to save");
      if (d.groups) setGroups(d.groups);
      await queryClient.invalidateQueries({ queryKey: ["college-info"] });
      toast({ variant: "success", title: "Timetable signature authority saved", description: "Ticked groups print on timetables from now on." });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to save", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  const total = groups.reduce((n, g) => n + g.designations.length, 0);
  const selectedCount = groups.reduce((n, g) => n + g.designations.filter((d) => d.selected).length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Timetable Signature Authority</CardTitle>
        <CardDescription>
          Add a group, then add its designations inside it (type several at once with <b>+</b>, e.g. Timetable In-Charge + HOD + Principal).
          Tick the designations to show under published timetables - all ticked designations print side by side in one row, like the usual signature line -
          then save. Type <b>HOD</b> to print the section&apos;s own HOD-&lt;dept&gt; label. With nothing ticked, the usual
          In-Charge / HOD / Principal row is printed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="sig-group-name">New group</Label>
          <div className="flex gap-2">
            <Input
              id="sig-group-name"
              value={groupName}
              placeholder={`Group ${groups.length + 1}`}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGroup(); } }}
            />
            <Button type="button" variant="outline" onClick={addGroup}>
              <Plus className="mr-1 h-4 w-4" /> Add group
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No groups yet - the default In-Charge / HOD / Principal row is printed.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.id} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${g.name}`}
                    onClick={() => setGroups((prev) => prev.filter((x) => x.id !== g.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {g.designations.length === 0 && <p className="text-xs text-muted-foreground">No designations yet - add some below.</p>}
                <div className="space-y-1.5">
                  {g.designations.map((d, j) => (
                    <div key={`${d.label}-${j}`} className="flex items-center gap-3">
                      <Checkbox
                        checked={d.selected}
                        aria-label={`Show ${d.label} on timetables`}
                        onCheckedChange={(v) =>
                          setDesignations(g.id, g.designations.map((x, k) => (k === j ? { ...x, selected: v === true } : x)))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{d.label}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${d.label}`}
                        onClick={() => setDesignations(g.id, g.designations.filter((_, k) => k !== j))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={drafts[g.id] ?? ""}
                    placeholder="Timetable In-Charge + HOD + Principal"
                    aria-label={`Designations for ${g.name}`}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [g.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDesignations(g); } }}
                  />
                  <Button type="button" variant="outline" onClick={() => addDesignations(g)} disabled={parseDesignations(drafts[g.id] ?? "").length === 0}>
                    <Plus className="mr-1 h-4 w-4" /> Add
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">{selectedCount} of {total} designations ticked</span>
          <Button onClick={handleSave} loading={isSaving} disabled={isLoading || groups.some((g) => g.designations.length === 0)}>
            Save Signature Authority
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
