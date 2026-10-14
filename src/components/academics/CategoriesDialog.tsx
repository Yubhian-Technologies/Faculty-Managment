"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoriesManager } from "@/components/academics/CategoriesManager";

// Opens Categories management inline, from wherever a category is actually
// needed (Course Structure, Import Subjects) - no navigating away to
// /academics/categories and losing the in-progress upload. `initialText`
// (and the `key` it drives on the caller's side, since this stays mounted
// for the dialog's whole open/close lifecycle) seeds the Add textarea with
// the exact values that were just rejected.
export function CategoriesDialog({
  open,
  onOpenChange,
  initialText = "",
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText?: string;
  onChanged?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Subject categories</DialogTitle>
        </DialogHeader>
        <CategoriesManager initialText={initialText} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}
