"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUBJECT_CATEGORY_LABELS } from "@/types";
import type { SubjectCategory } from "@/types";

const NEW_CATEGORY_VALUE = "__new__";

interface CategoryFieldProps {
  category: SubjectCategory | "";
  customCategory: string;
  onCategoryChange: (category: SubjectCategory) => void;
  onCustomCategoryChange: (value: string) => void;
}

// Shared by Add Subject, Edit Subject and the bulk-import "fix row" dialog.
// Categories aren't a fixed enum (see SubjectCategory's own doc-comment,
// types/teaching.ts) - options are the AICTE defaults plus every category
// already in use anywhere else in the college's Subjects (GET
// /api/college/subjects/categories), no separate "manage categories" screen
// or collection. Picking "+ Add new category" sets `category` directly to
// whatever's typed - reusable again for the next subject the moment this one
// is saved. "Other" (customCategory) is kept only so a subject that already
// used it before this existed still edits correctly.
export function CategoryField({ category, customCategory, onCategoryChange, onCustomCategoryChange }: CategoryFieldProps) {
  const [categories, setCategories] = useState<string[]>(
    Object.keys(SUBJECT_CATEGORY_LABELS).filter((c) => c !== "OTHER")
  );
  const [addingNew, setAddingNew] = useState(false);
  const [newCategoryText, setNewCategoryText] = useState("");

  useEffect(() => {
    fetch("/api/college/subjects/categories")
      .then((r) => r.json() as Promise<{ categories?: string[] }>)
      .then((d) => { if (d.categories?.length) setCategories(d.categories); })
      .catch(() => { /* non-critical - falls back to the AICTE defaults */ });
  }, []);

  function handleSelect(value: string) {
    if (value === NEW_CATEGORY_VALUE) {
      setAddingNew(true);
      return;
    }
    setAddingNew(false);
    onCategoryChange(value as SubjectCategory);
  }

  function confirmNewCategory() {
    const trimmed = newCategoryText.trim();
    if (!trimmed) return;
    onCategoryChange(trimmed as SubjectCategory);
    setAddingNew(false);
    setNewCategoryText("");
  }

  return (
    <div className="space-y-2">
      <Label>Category *</Label>
      <Select value={addingNew ? NEW_CATEGORY_VALUE : category} onValueChange={handleSelect}>
        <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>{(SUBJECT_CATEGORY_LABELS as Record<string, string>)[c] ?? c}</SelectItem>
          ))}
          <SelectItem value="OTHER">{SUBJECT_CATEGORY_LABELS.OTHER}</SelectItem>
          <SelectItem value={NEW_CATEGORY_VALUE}>+ Add new category…</SelectItem>
        </SelectContent>
      </Select>
      {addingNew && (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={newCategoryText}
            onChange={(e) => setNewCategoryText(e.target.value)}
            placeholder="Enter new category name"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmNewCategory(); } }}
          />
          <Button type="button" size="sm" onClick={confirmNewCategory}>Add</Button>
        </div>
      )}
      {!addingNew && category === "OTHER" && (
        <Input
          value={customCategory}
          onChange={(e) => onCustomCategoryChange(e.target.value)}
          placeholder="Enter category name"
        />
      )}
    </div>
  );
}
