"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { SUBJECT_TYPE_LABELS } from "@/types";
import type { SubjectCategory, SubjectType } from "@/types";
import { CategoryField } from "@/components/academics/CategoryField";

const SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";

interface Form {
  category: SubjectCategory | ""; customCategory: string;
  name: string; code: string; shortCode: string; type: SubjectType | "";
  lectureHours: string; tutorialHours: string; practicalHours: string; credits: string;
  excludeFromTeachingLoad: boolean;
}
const EMPTY: Form = {
  category: "", customCategory: "", name: "", code: "", shortCode: "", type: "",
  lectureHours: "", tutorialHours: "", practicalHours: "", credits: "", excludeFromTeachingLoad: false,
};

// Adds ONE subject to the master list of a Course + Regulation. No department, year or semester -
// putting it into a semester is the separate "Assign by code" step. Nothing is pre-filled for the
// numbers: L, T, P and Credits must be entered (0 where there are none).
export function AddSubjectDialog({ open, onOpenChange, courseId, courseName, regulation, onAdded }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseName: string;
  regulation: string;
  onAdded: () => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/college/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId, regulation,
          category: form.category, customCategory: form.customCategory,
          name: form.name, code: form.code, shortCode: form.shortCode,
          type: form.type || undefined,
          lectureHours: form.lectureHours, tutorialHours: form.tutorialHours, practicalHours: form.practicalHours, credits: form.credits,
          excludeFromTeachingLoad: form.excludeFromTeachingLoad,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(json.error ?? "Couldn't save the subject."); return; }
      toast({ variant: "success", title: `${form.code.trim().toUpperCase()} added` });
      setForm(EMPTY);
      onOpenChange(false);
      onAdded();
    } catch {
      setError("Network error. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setError(""); } onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Subject</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">{courseName} · {regulation}. Assign it to a semester afterwards with Assign by code.</p>
        <div className="space-y-3">
          <CategoryField
            category={form.category}
            customCategory={form.customCategory}
            onCategoryChange={(c) => set("category", c)}
            onCustomCategoryChange={(v) => set("customCategory", v)}
            allowNew={false}
          />
          <div className="space-y-1.5"><Label>Subject Name *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Subject Code *</Label><Input value={form.code} onChange={(e) => set("code", e.target.value)} className="font-mono uppercase" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Short Code</Label><Input value={form.shortCode} onChange={(e) => set("shortCode", e.target.value)} className="uppercase" /></div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select className={SELECT_CLASS} value={form.type} onChange={(e) => set("type", e.target.value as SubjectType | "")}>
                <option value="">Automatic (from L-T-P)</option>
                {Object.entries(SUBJECT_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5"><Label>L *</Label><Input inputMode="decimal" value={form.lectureHours} onChange={(e) => set("lectureHours", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>T *</Label><Input inputMode="decimal" value={form.tutorialHours} onChange={(e) => set("tutorialHours", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>P *</Label><Input inputMode="decimal" value={form.practicalHours} onChange={(e) => set("practicalHours", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Credits *</Label><Input inputMode="decimal" value={form.credits} onChange={(e) => set("credits", e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.excludeFromTeachingLoad} onCheckedChange={(v) => set("excludeFromTeachingLoad", v === true)} />
            Don&apos;t include in teaching load
          </label>
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-destructive/20 dark:bg-destructive/10 dark:text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={saving}>Add Subject</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
