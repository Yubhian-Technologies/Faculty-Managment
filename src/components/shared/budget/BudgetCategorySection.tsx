"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { BudgetItemsTable } from "@/components/shared/budget/BudgetItemsTable";
import { reconcileExtrasForCategory, sectionTotal, type BudgetCategoryGroup, type BudgetRequestItem } from "@/types";

function emptyItem(): BudgetRequestItem {
  return { id: crypto.randomUUID(), title: "", description: "", price: 0, extras: {}, customFields: [] };
}

function emptyGroup(): BudgetCategoryGroup {
  return { id: crypto.randomUUID(), category: "", items: [emptyItem()] };
}

interface CategoryGroupCardProps {
  group: BudgetCategoryGroup;
  categories: readonly string[];
  onChange: (group: BudgetCategoryGroup) => void;
  onRemove: () => void;
  removable: boolean;
}

function CategoryGroupCard({ group, categories, onChange, onRemove, removable }: CategoryGroupCardProps) {
  const isCustom = !!group.category && !(categories as readonly string[]).includes(group.category);
  const [selectValue, setSelectValue] = useState(isCustom ? "Other" : group.category);
  const [customCategory, setCustomCategory] = useState(isCustom ? group.category : "");

  function applyCategory(category: string) {
    const items = reconcileExtrasForCategory(group.items, category);
    onChange({ ...group, category, items });
  }

  function handleSelectChange(value: string) {
    setSelectValue(value);
    applyCategory(value !== "Other" ? value : customCategory);
  }

  function handleCustomChange(value: string) {
    setCustomCategory(value);
    applyCategory(value);
  }

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Category <span className="text-destructive">*</span></Label>
            <Select value={selectValue} onValueChange={handleSelectChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectValue === "Other" && (
            <div className="space-y-2">
              <Label>Specify Category <span className="text-destructive">*</span></Label>
              <Input
                value={customCategory}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder="Enter category..."
              />
            </div>
          )}
        </div>
        {removable && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Remove category">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
      <BudgetItemsTable
        items={group.items}
        onChange={(items) => onChange({ ...group, items })}
        category={group.category}
      />
    </div>
  );
}

function CategoryGroupReadOnly({ group }: { group: BudgetCategoryGroup }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <p className="text-sm font-semibold">{group.category}</p>
      <BudgetItemsTable items={group.items} readOnly category={group.category} />
    </div>
  );
}

interface BudgetCategorySectionProps {
  label: string;
  categories: readonly string[];
  groups: BudgetCategoryGroup[];
  onChange?: (groups: BudgetCategoryGroup[]) => void;
  readOnly?: boolean;
}

export function BudgetCategorySection({ label, categories, groups, onChange, readOnly = false }: BudgetCategorySectionProps) {
  function updateGroup(id: string, updated: BudgetCategoryGroup) {
    onChange?.(groups.map((g) => (g.id === id ? updated : g)));
  }

  function addGroup() {
    onChange?.([...groups, emptyGroup()]);
  }

  function removeGroup(id: string) {
    onChange?.(groups.filter((g) => g.id !== id));
  }

  const total = sectionTotal(groups);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-sm font-medium text-muted-foreground">{formatCurrency(total)}</span>
      </div>

      {groups.length === 0 && readOnly && (
        <p className="text-sm text-muted-foreground">No items in this section.</p>
      )}

      <div className="space-y-3">
        {groups.map((group) =>
          readOnly ? (
            <CategoryGroupReadOnly key={group.id} group={group} />
          ) : (
            <CategoryGroupCard
              key={group.id}
              group={group}
              categories={categories}
              onChange={(updated) => updateGroup(group.id, updated)}
              onRemove={() => removeGroup(group.id)}
              removable={groups.length > 1}
            />
          )
        )}
      </div>

      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={addGroup}>
          <Plus className="h-4 w-4 mr-1" />
          Add Category
        </Button>
      )}
    </div>
  );
}

export { emptyGroup as emptyBudgetCategoryGroup };
