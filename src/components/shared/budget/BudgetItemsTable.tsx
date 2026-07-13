"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import type { BudgetRequestItem } from "@/types";

interface BudgetItemsTableProps {
  items: BudgetRequestItem[];
  onChange?: (items: BudgetRequestItem[]) => void;
  readOnly?: boolean;
}

export function BudgetItemsTable({ items, onChange, readOnly = false }: BudgetItemsTableProps) {
  function updateItem(id: string, patch: Partial<BudgetRequestItem>) {
    onChange?.(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addItem() {
    onChange?.([
      ...items,
      { id: crypto.randomUUID(), itemName: "", specification: "", quantity: 1, unitPrice: 0 },
    ]);
  }

  function removeItem(id: string) {
    onChange?.(items.filter((item) => item.id !== id));
  }

  const grandTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item Name</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Specification</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-24">Quantity</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-32">Unit Price</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-32">Total</th>
                {!readOnly && <th className="px-3 py-2 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) =>
                readOnly ? (
                  <tr key={item.id} className="bg-background">
                    <td className="px-3 py-2">{item.itemName}</td>
                    <td className="px-3 py-2">{item.specification}</td>
                    <td className="px-3 py-2">{item.quantity}</td>
                    <td className="px-3 py-2">{formatCurrency(item.unitPrice)}</td>
                    <td className="px-3 py-2 font-medium">{formatCurrency(item.quantity * item.unitPrice)}</td>
                  </tr>
                ) : (
                  <tr key={item.id} className="bg-background">
                    <td className="px-3 py-2">
                      <Input
                        value={item.itemName}
                        onChange={(e) => updateItem(item.id, { itemName: e.target.value })}
                        placeholder="e.g. Oscilloscope"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={item.specification}
                        onChange={(e) => updateItem(item.id, { specification: e.target.value })}
                        placeholder="e.g. 100MHz, 4-channel"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, { quantity: Math.max(1, Number(e.target.value)) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        value={item.unitPrice}
                        onChange={(e) => updateItem(item.id, { unitPrice: Math.max(0, Number(e.target.value)) })}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">
                      {formatCurrency(item.quantity * item.unitPrice)}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(item.id)}
                        disabled={items.length === 1}
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                )
              )}
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
