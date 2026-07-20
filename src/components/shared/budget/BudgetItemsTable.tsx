"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, stripLeadingZeros } from "@/lib/utils";
import { fieldConfigForCategory, itemTotal, DESIGNATION_LABELS, EMPLOYMENT_TYPE_LABELS, type BudgetCategoryFieldConfig, type BudgetExtraFieldDef, type BudgetExtraFieldType, type BudgetRequestItem, type SalaryStructure, type FacultyMember } from "@/types";

// Radix Select disallows an empty-string item value, so "none" is the sentinel
// for "no salary structure selected / enter price manually" and is translated
// to/from "" (the actual stored extras value) at the read/write boundary.
const CUSTOM_SALARY_OPTION = "none";

function salaryStructureLabel(s: SalaryStructure): string {
  return `${DESIGNATION_LABELS[s.designation]} · ${EMPLOYMENT_TYPE_LABELS[s.employmentType]}`;
}

function headcountKey(designation: string, employmentType: string): string {
  return `${designation}|${employmentType}`;
}

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
  // HOD's own department is resolved server-side, so this is only needed for
  // the Principal/VP emergency-request form where department is free text.
  department?: string;
}

export function BudgetItemsTable({ items, onChange, readOnly = false, category, department }: BudgetItemsTableProps) {
  const cfg = fieldConfigForCategory(category);
  const hasMultiplier = cfg.extraFields.some((f) => f.isMultiplier) || !!cfg.fixedTotalMultiplier;
  const priceLabel = cfg.priceLabel ?? (hasMultiplier ? "Unit Price" : "Amount");
  const totalLabel = cfg.totalLabel ?? "Total";
  const isStaffSalaries = category === "Staff Salaries";
  const colCount = 4 + cfg.extraFields.length + (isStaffSalaries ? 1 : 0) + (readOnly ? 0 : 1); // Title, Description, extraFields, [Staff Count], Price, Total, (+ delete)

  const [salaryStructures, setSalaryStructures] = useState<SalaryStructure[]>([]);
  useEffect(() => {
    if (category !== "Staff Salaries") return;
    let cancelled = false;
    fetch("/api/college/salary-structures?activeOnly=true")
      .then((r) => r.json() as Promise<{ salaryStructures: SalaryStructure[] }>)
      .then((data) => { if (!cancelled) setSalaryStructures(data.salaryStructures ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [category]);

  // Headcount per designation+employmentType, used to auto-total a Staff
  // Salaries line item across every active faculty member at that designation
  // rather than just one — only needed while editing (read-only views render
  // the count already frozen into extras.headcount by the server).
  const [headcountByKey, setHeadcountByKey] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!isStaffSalaries || readOnly) return;
    let cancelled = false;
    const params = new URLSearchParams({ status: "ACTIVE" });
    if (department) params.set("department", department);
    fetch(`/api/college/faculty?${params.toString()}`)
      .then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>)
      .then((data) => {
        if (cancelled) return;
        const map = new Map<string, number>();
        for (const f of data.faculty ?? []) {
          const key = headcountKey(f.designation, f.employmentType);
          map.set(key, (map.get(key) ?? 0) + 1);
        }
        setHeadcountByKey(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isStaffSalaries, readOnly, department]);

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
                {isStaffSalaries && <th className="px-3 py-2 text-left font-medium text-muted-foreground w-24">Staff Count</th>}
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
                  salaryStructures={salaryStructures}
                  headcountByKey={headcountByKey}
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
  salaryStructures: SalaryStructure[];
  headcountByKey: Map<string, number>;
  onUpdate: (patch: Partial<BudgetRequestItem>) => void;
  onRemove: () => void;
}

function ItemRows({ item, cfg, category, readOnly, colCount, removable, salaryStructures, headcountByKey, onUpdate, onRemove }: ItemRowsProps) {
  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftType, setDraftType] = useState<"TEXT" | "NUMBER">("TEXT");
  const [draftMultiplier, setDraftMultiplier] = useState(false);

  const customFields = item.customFields ?? [];
  const isStaffSalaries = category === "Staff Salaries";

  function updateExtra(key: string, value: string, type: BudgetExtraFieldType = "TEXT") {
    const normalized = type === "NUMBER" ? stripLeadingZeros(value) : value;
    onUpdate({ extras: { ...item.extras, [key]: normalized } });
  }

  function selectSalaryStructure(structureId: string) {
    if (!structureId) {
      onUpdate({ extras: { ...item.extras, salaryStructureId: "", headcount: "" } });
      return;
    }
    const structure = salaryStructures.find((s) => s.id === structureId);
    const headcount = structure ? headcountByKey.get(headcountKey(structure.designation, structure.employmentType)) ?? 0 : 0;
    onUpdate({
      extras: { ...item.extras, salaryStructureId: structureId, headcount: String(headcount) },
      price: structure?.grossSalary ?? item.price,
    });
  }

  const selectedSalaryStructure = salaryStructures.find((s) => s.id === item.extras.salaryStructureId);
  const priceLocked = category === "Staff Salaries" && !!item.extras.salaryStructureId;
  const staffCount = item.extras.headcount;

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
            <td key={f.key} className="px-3 py-2">
              {f.key === "salaryStructureId"
                ? (selectedSalaryStructure ? salaryStructureLabel(selectedSalaryStructure) : item.extras[f.key] || "—")
                : item.extras[f.key]}
            </td>
          ))}
          {isStaffSalaries && <td className="px-3 py-2">{staffCount || "—"}</td>}
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
              {f.type === "SELECT" ? (
                <Select
                  value={item.extras[f.key] || CUSTOM_SALARY_OPTION}
                  onValueChange={(v) => {
                    const stored = v === CUSTOM_SALARY_OPTION ? "" : v;
                    if (f.key === "salaryStructureId") selectSalaryStructure(stored);
                    else updateExtra(f.key, stored);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${f.label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CUSTOM_SALARY_OPTION}>— Custom (enter manually) —</SelectItem>
                    {(f.key === "salaryStructureId" ? salaryStructures : []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{salaryStructureLabel(s)}</SelectItem>
                    ))}
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={f.type === "NUMBER" ? "number" : "text"}
                  min={f.type === "NUMBER" ? 0 : undefined}
                  value={item.extras[f.key] ?? ""}
                  onChange={(e) => updateExtra(f.key, e.target.value, f.type)}
                  placeholder={f.placeholder}
                />
              )}
            </td>
          ))}
          {isStaffSalaries && (
            <td className="px-3 py-2 text-muted-foreground">
              {staffCount ? `${staffCount} active` : selectedSalaryStructure ? "0 active" : "—"}
            </td>
          )}
          <td className="px-3 py-2">
            <Input
              type="number"
              min={0}
              disabled={priceLocked}
              value={item.price === 0 ? "" : item.price}
              onChange={(e) => {
                const raw = e.target.value;
                onUpdate({ price: raw === "" ? 0 : Math.max(0, Number(raw)) });
              }}
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
                        onChange={(e) => updateExtra(f.key, e.target.value, f.type)}
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
