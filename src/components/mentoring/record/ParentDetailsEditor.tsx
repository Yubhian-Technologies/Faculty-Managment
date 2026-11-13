"use client";

import { useState } from "react";
import { UserPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { sendJson, useLoaded } from "./recordApi";

// "Correct parent details" on the Mentoring Record: for the student's mentor, their HOD and the Principal / Vice
// Principal (the server decides - the button only shows when it says this person may). Saves to the student's own
// record (api/college/mentoring/parent-details/[id]); students can't change these themselves.

const GROUPS: { title: string; fields: { key: string; phone?: boolean }[] }[] = [
  { title: "Father", fields: [{ key: "fatherName" }, { key: "fatherOccupation" }, { key: "fatherContactNo", phone: true }] },
  { title: "Mother", fields: [{ key: "motherName" }, { key: "motherOccupation" }, { key: "motherContactNo", phone: true }] },
  { title: "Guardian (if any)", fields: [{ key: "guardianName" }, { key: "guardianContact", phone: true }] },
];

interface ParentDetails { canEdit: boolean; values: Record<string, string>; labels: Record<string, string> }

export function ParentDetailsEditor({ studentId, onSaved }: { studentId: string; onSaved: () => void }) {
  const { data, setData } = useLoaded<ParentDetails>(studentId ? `/api/college/mentoring/parent-details/${encodeURIComponent(studentId)}` : null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!data?.canEdit) return null;

  const changes = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v.trim() !== (data.values[k] ?? "")));

  async function save() {
    setSaving(true);
    try {
      const res = await sendJson<{ values: Record<string, string>; changed: string[] }>(`/api/college/mentoring/parent-details/${encodeURIComponent(studentId)}`, "PATCH", { details: changes });
      setData({ ...data!, values: res.values });
      toast({ title: res.changed.length ? "Parent details updated" : "No changes" });
      setOpen(false);
      onSaved();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="print:hidden" onClick={() => { setDraft({ ...data.values }); setOpen(true); }}>
        <UserPen className="h-4 w-4 mr-1.5" /> Correct parent details
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Correct parent details</DialogTitle>
            <DialogDescription>Saved on the student&apos;s own record, so every page shows the new details. Mobile numbers are 10 digits.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {GROUPS.map((g) => (
              <fieldset key={g.title} className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{g.title}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {g.fields.map((f) => (
                    <div key={f.key} className="space-y-1.5">
                      <Label htmlFor={`pd-${f.key}`} className="text-xs">{data.labels[f.key] ?? f.key}</Label>
                      <Input
                        id={`pd-${f.key}`} value={draft[f.key] ?? ""} inputMode={f.phone ? "tel" : undefined} maxLength={f.phone ? 16 : 200}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || Object.keys(changes).length === 0}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
