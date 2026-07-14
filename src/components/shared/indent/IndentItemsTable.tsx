"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { indentItemTotal, indentItemsTotal, type IndentItem } from "@/types";

function emptyItem(): IndentItem {
  return { id: crypto.randomUUID(), description: "", quantity: 1, estimatedUnitPrice: 0 };
}

interface IndentItemsTableProps {
  items: IndentItem[];
  onChange?: (items: IndentItem[]) => void;
  readOnly?: boolean;
}

export function IndentItemsTable({ items, onChange, readOnly = false }: IndentItemsTableProps) {
  function updateItem(id: string, patch: Partial<IndentItem>) {
    onChange?.(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addItem() {
    onChange?.([...items, emptyItem()]);
  }

  function removeItem(id: string) {
    onChange?.(items.filter((item) => item.id !== id));
  }

  const grandTotal = indentItemsTotal(items);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-28">Quantity</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-36">Est. Unit Price</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-36">Total</th>
                {!readOnly && <th className="px-3 py-2 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => (
                <tr key={item.id} className="bg-background">
                  {readOnly ? (
                    <>
                      <td className="px-3 py-2">{item.description}</td>
                      <td className="px-3 py-2">{item.quantity}</td>
                      <td className="px-3 py-2">{formatCurrency(item.estimatedUnitPrice)}</td>
                      <td className="px-3 py-2 font-medium">{formatCurrency(indentItemTotal(item))}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2">
                        <Input value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} placeholder="e.g. A4 printer paper" />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min={1} value={item.quantity} onChange={(e) => updateItem(item.id, { quantity: Math.max(0, Number(e.target.value)) })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min={0} value={item.estimatedUnitPrice} onChange={(e) => updateItem(item.id, { estimatedUnitPrice: Math.max(0, Number(e.target.value)) })} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{formatCurrency(indentItemTotal(item))}</td>
                      <td className="px-3 py-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(item.id)} disabled={items.length <= 1} aria-label="Remove item">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </>
                  )}
                </tr>
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
        <span className="text-sm font-medium text-muted-foreground">Estimated Total</span>
        <Input value={formatCurrency(grandTotal)} disabled className="w-40 bg-muted font-semibold text-right" />
      </div>
    </div>
  );
}
