"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { fieldConfigForCategory, itemTotal, type BudgetCategoryFieldConfig, type BudgetExtraFieldDef, type BudgetRequestItem } from "@/types";

function emptyItem(category: string): BudgetRequestItem {
  const cfg = fieldConfigForCategory(category);
  return {
    id: crypto.randomUUID(),
    title: "",
    description: "",
    price: 0,
    extras: Object.fromEntries(cfg.extraFields.map((f) => [f.key, ""])),
    customFields: [],
  };
}

interface BudgetItemsTableProps {
  items: BudgetRequestItem[];
  onChange?: (items: BudgetRequestItem[]) => void;
  readOnly?: boolean;
  category: string;
}

export function BudgetItemsTable({ items, onChange, readOnly = false, category }: BudgetItemsTableProps) {
  const cfg = fieldConfigForCategory(category);
  const hasMultiplier = cfg.extraFields.some((f) => f.isMultiplier) || !!cfg.fixedTotalMultiplier;
  const priceLabel = cfg.priceLabel ?? (hasMultiplier ? "Unit Price" : "Amount");
  const totalLabel = cfg.totalLabel ?? "Total";
  const colCount = 4 + cfg.extraFields.length + (readOnly ? 0 : 1); // Title, Description, extraFields, Price, Total, (+ delete)

  function updateItem(id: string, patch: Partial<BudgetRequestItem>) {
    onChange?.(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addItem() {
    onChange?.([...items, emptyItem(category)]);
  }

  function removeItem(id: string) {
    onChange?.(items.filter((item) => item.id !== id));
  }

  const grandTotal = items.reduce((sum, item) => sum + itemTotal(item, category), 0);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Title</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Description</th>
                {cfg.extraFields.map((f) => (
                  <th key={f.key} className="px-3 py-2 text-left font-medium text-muted-foreground w-32">{f.label}</th>
                ))}
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-36">{priceLabel}</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-36">{totalLabel}</th>
                {!readOnly && <th className="px-3 py-2 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => (
                <ItemRows
                  key={item.id}
                  item={item}
                  cfg={cfg}
                  category={category}
                  readOnly={readOnly}
                  colCount={colCount}
                  removable={items.length > 1}
                  onUpdate={(patch) => updateItem(item.id, patch)}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus className="h-4 w-4 mr-1" />
          Add Item
        </Button>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t">
        <span className="text-sm font-medium text-muted-foreground">Grand Total</span>
        <Input
          value={formatCurrency(grandTotal)}
          disabled
          className="w-40 bg-muted font-semibold text-right"
        />
      </div>
    </div>
  );
}

interface ItemRowsProps {
  item: BudgetRequestItem;
  cfg: BudgetCategoryFieldConfig;
  category: string;
  readOnly: boolean;
  colCount: number;
  removable: boolean;
  onUpdate: (patch: Partial<BudgetRequestItem>) => void;
  onRemove: () => void;
}

function ItemRows({ item, cfg, category, readOnly, colCount, removable, onUpdate, onRemove }: ItemRowsProps) {
  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftType, setDraftType] = useState<"TEXT" | "NUMBER">("TEXT");
  const [draftMultiplier, setDraftMultiplier] = useState(false);

  const customFields = item.customFields ?? [];

  function updateExtra(key: string, value: string) {
    onUpdate({ extras: { ...item.extras, [key]: value } });
  }

  function resetDraft() {
    setAdding(false);
    setDraftLabel("");
    setDraftType("TEXT");
    setDraftMultiplier(false);
  }

  function commitField() {
    if (!draftLabel.trim()) return;
    const newField: BudgetExtraFieldDef = {
      key: `custom_${crypto.randomUUID()}`,
      label: draftLabel.trim(),
      type: draftType,
      isMultiplier: draftType === "NUMBER" && draftMultiplier,
    };
    onUpdate({
      customFields: [...customFields, newField],
      extras: { ...item.extras, [newField.key]: "" },
    });
    resetDraft();
  }

  function removeCustomField(key: string) {
    const restExtras = { ...item.extras };
    delete restExtras[key];
    onUpdate({
      customFields: customFields.filter((f) => f.key !== key),
      extras: restExtras,
    });
  }

  return (
    <>
      {readOnly ? (
        <tr className="bg-background">
          <td className="px-3 py-2">{item.title}</td>
          <td className="px-3 py-2">{item.description}</td>
          {cfg.extraFields.map((f) => (
            <td key={f.key} className="px-3 py-2">{item.extras[f.key]}</td>
          ))}
          <td className="px-3 py-2">{formatCurrency(item.price)}</td>
          <td className="px-3 py-2 font-medium">{formatCurrency(itemTotal(item, category))}</td>
        </tr>
      ) : (
        <tr className="bg-background">
          <td className="px-3 py-2">
            <Input value={item.title} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="e.g. Oscilloscope" />
          </td>
          <td className="px-3 py-2">
            <Input value={item.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="Brief description" />
          </td>
          {cfg.extraFields.map((f) => (
            <td key={f.key} className="px-3 py-2">
              <Input
                type={f.type === "NUMBER" ? "number" : "text"}
                min={f.type === "NUMBER" ? 0 : undefined}
                value={item.extras[f.key] ?? ""}
                onChange={(e) => updateExtra(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            </td>
          ))}
          <td className="px-3 py-2">
            <Input
              type="number"
              min={0}
              value={item.price}
              onChange={(e) => onUpdate({ price: Math.max(0, Number(e.target.value)) })}
            />
          </td>
          <td className="px-3 py-2 whitespace-nowrap font-medium">
            {formatCurrency(itemTotal(item, category))}
          </td>
          <td className="px-3 py-2">
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={!removable} aria-label="Remove item">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </td>
        </tr>
      )}

      {(customFields.length > 0 || !readOnly) && (
        <tr className="bg-muted/20">
          <td colSpan={colCount} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {customFields.map((f) => (
                <div key={f.key} className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
                  <span className="text-xs text-muted-foreground">{f.label}:</span>
                  {readOnly ? (
                    <span className="text-xs font-medium">{item.extras[f.key] || "—"}</span>
                  ) : (
                    <>
                      <Input
                        type={f.type === "NUMBER" ? "number" : "text"}
                        value={item.extras[f.key] ?? ""}
                        onChange={(e) => updateExtra(f.key, e.target.value)}
                        className="h-7 w-28 text-xs"
                      />
                      <button type="button" onClick={() => removeCustomField(f.key)} aria-label={`Remove ${f.label}`}>
                        <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </>
                  )}
                </div>
              ))}

              {!readOnly && !adding && (
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdding(true)}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add Field
                </Button>
              )}

              {!readOnly && adding && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
                  <Input
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    placeholder="Field name, e.g. Vendor Name"
                    className="h-7 w-40 text-xs"
                    autoFocus
                  />
                  <Select value={draftType} onValueChange={(v) => setDraftType(v as "TEXT" | "NUMBER")}>
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TEXT">Text</SelectItem>
                      <SelectItem value="NUMBER">Number</SelectItem>
                    </SelectContent>
                  </Select>
                  {draftType === "NUMBER" && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox checked={draftMultiplier} onCheckedChange={(v) => setDraftMultiplier(!!v)} />
                      Use for total
                    </label>
                  )}
                  <Button type="button" size="sm" className="h-7 text-xs" onClick={commitField}>Add</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={resetDraft}>Cancel</Button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
