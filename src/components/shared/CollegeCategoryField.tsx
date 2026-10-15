"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { CollegeCategory } from "@/types";

// Main / Test college category picker (see lib/colleges/category.ts for what the category does). One field shared by the
// Add College and Edit College screens so the wording is identical everywhere.
export function CollegeCategoryField({
  value, onChange, idPrefix = "college-category",
}: {
  value: CollegeCategory;
  onChange: (next: CollegeCategory) => void;
  idPrefix?: string;
}) {
  const options: { key: CollegeCategory; title: string; hint: string }[] = [
    { key: "MAIN", title: "Main college", hint: "A real college. Sees other Main colleges in cross-college lists (e.g. a publication author's affiliation)." },
    { key: "TEST", title: "Test college", hint: "A test or demo college. Sees only other Test colleges, and is hidden from Main colleges." },
  ];
  return (
    <div className="space-y-2">
      <Label>College Category</Label>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as CollegeCategory)} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.key}
            htmlFor={`${idPrefix}-${o.key}`}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors ${value === o.key ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
          >
            <RadioGroupItem id={`${idPrefix}-${o.key}`} value={o.key} className="mt-0.5" />
            <span>
              <span className="block font-medium">{o.title}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
