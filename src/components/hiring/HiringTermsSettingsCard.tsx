"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Check, X } from "lucide-react";
import { toast } from "@/hooks/useToast";
import type { HiringTermsTemplate } from "@/types";

export function HiringTermsSettingsCard() {
  const [templates, setTemplates] = useState<HiringTermsTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/college/hiring-terms?includeInactive=true")
      .then((r) => r.json() as Promise<{ templates: HiringTermsTemplate[] }>)
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load terms & conditions" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function addTemplate() {
    const text = newText.trim();
    if (!text) return;
    setIsAdding(true);
    try {
      const res = await fetch("/api/college/hiring-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      setNewText("");
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to add term" });
    } finally {
      setIsAdding(false);
    }
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/college/hiring-terms/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      setEditingId(null);
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to save changes" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(t: HiringTermsTemplate) {
    setBusyId(t.id);
    try {
      const res = await fetch(`/api/college/hiring-terms/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hiring Pipeline Terms &amp; Conditions</CardTitle>
        <CardDescription>
          Manage the reusable terms &amp; conditions Principals can select from when negotiating an offer at /principal/negotiate
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="h-16 bg-muted animate-pulse rounded-lg" />
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No terms added yet.</p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-start gap-2 rounded-lg border p-2.5">
                {editingId === t.id ? (
                  <>
                    <Input
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveEdit(t.id); } }}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" loading={busyId === t.id} onClick={() => void saveEdit(t.id)}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <p className={`flex-1 text-sm ${t.isActive ? "" : "text-muted-foreground line-through"}`}>{t.text}</p>
                    {!t.isActive && <Badge variant="secondary" className="text-[10px] shrink-0">Inactive</Badge>}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => { setEditingId(t.id); setEditText(t.text); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs shrink-0"
                      loading={busyId === t.id}
                      onClick={() => void toggleActive(t)}
                    >
                      {t.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t">
          <Input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addTemplate(); } }}
            placeholder="e.g. Probationary period of one year"
            className="text-sm"
          />
          <Button type="button" variant="outline" loading={isAdding} onClick={() => void addTemplate()}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
