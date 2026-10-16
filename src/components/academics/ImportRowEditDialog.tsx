"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SUBJECT_TYPE_LABELS } from "@/types";
import type { SubjectCategory } from "@/types";
import { CategoryField } from "@/components/academics/CategoryField";
import type { SubjectRowInput } from "@/lib/subjects/validation/SubjectValidator";

const SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";

interface Form {
  category: SubjectCategory | ""; customCategory: string;
  name: string; code: string; shortCode: string; type: string;
  lectureHours: string; tutorialHours: string; practicalHours: string; credits: string;
}

function toForm(d: SubjectRowInput): Form {
  return {
    category: (d.category?.toString().trim() as SubjectCategory) || "",
    customCategory: d.customCategory?.toString() ?? "",
    name: d.name?.toString() ?? "",
    code: d.code?.toString() ?? "",
    shortCode: d.shortCode?.toString() ?? "",
    type: d.type?.toString() ?? "",
    lectureHours: d.lectureHours != null ? String(d.lectureHours) : "",
    tutorialHours: d.tutorialHours != null ? String(d.tutorialHours) : "",
    practicalHours: d.practicalHours != null ? String(d.practicalHours) : "",
    credits: d.credits != null ? String(d.credits) : "",
  };
}

// Fixes one bad row from a bulk subject import in place, instead of editing the
// file and re-uploading it for a single typo. Only the fields the template asks
// for a human to type are editable here; anything else on the row (total hours
// per semester, marks) is carried over untouched. Saving only updates this row
// in memory - the caller re-checks the whole batch (and the real save) from there.
export function ImportRowEditDialog({ open, onOpenChange, rowNumber, errors, data, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowNumber: number;
  errors: string[];
  data: SubjectRowInput;
  onSave: (data: SubjectRowInput) => void;
}) {
  const [form, setForm] = useState<Form>(() => toForm(data));
  useEffect(() => { if (open) setForm(toForm(data)); }, [open, data]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function save() {
    onSave({
      ...data,
      category: form.category,
      customCategory: form.customCategory,
      name: form.name,
      code: form.code,
      shortCode: form.shortCode,
      type: form.type || undefined,
      lectureHours: form.lectureHours,
      tutorialHours: form.tutorialHours,
      practicalHours: form.practicalHours,
      credits: form.credits,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Fix row {rowNumber}</DialogTitle></DialogHeader>
        {errors.length > 0 && (
          <ul className="list-disc space-y-0.5 rounded-md border border-red-200 bg-red-50 p-2 pl-6 text-xs text-red-700 dark:border-destructive/20 dark:bg-destructive/10 dark:text-red-400">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        <div className="space-y-3">
          <CategoryField
            category={form.category}
            customCategory={form.customCategory}
            onCategoryChange={(c) => set("category", c)}
            onCustomCategoryChange={(v) => set("customCategory", v)}
            allowNew={false}
          />
          <div className="space-y-1.5"><Label>Subject Name *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Subject Code *</Label><Input value={form.code} onChange={(e) => set("code", e.target.value)} className="font-mono uppercase" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Short Code</Label><Input value={form.shortCode} onChange={(e) => set("shortCode", e.target.value)} className="uppercase" /></div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select className={SELECT_CLASS} value={form.type} onChange={(e) => set("type", e.target.value)}>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save row</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
