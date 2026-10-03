"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NavIcon, NAV_ICON_NAMES } from "@/components/layout/NavIcon";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { CustomPage, UserRole } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collegeId: string;
  /** The role whose sidebar is being edited - pre-ticked. */
  role: UserRole;
  /** Roles a tab can be offered to. */
  roles: UserRole[];
  /** 1-based position the new tab will take. */
  position: number;
  onCreated: (page: CustomPage) => void;
}

// Step 1 of adding a tab: its name, icon, who sees it. The page's content is
// built afterwards in the page editor.
export function AddTabDialog({ open, onOpenChange, collegeId, role, roles, position, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [iconName, setIconName] = useState("FileText");
  const [section, setSection] = useState("");
  const [selected, setSelected] = useState<Set<UserRole>>(new Set([role]));
  const [saving, setSaving] = useState(false);

  function toggle(r: UserRole, on: boolean) {
    setSelected((prev) => { const n = new Set(prev); if (on) n.add(r); else n.delete(r); return n; });
  }

  async function create() {
    if (!title.trim()) { toast({ variant: "destructive", title: "Give the tab a name" }); return; }
    if (selected.size === 0) { toast({ variant: "destructive", title: "Choose at least one role" }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/custom-nav/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId, title, iconName, section, roles: Array.from(selected), enabled: true }),
      });
      const json = (await res.json()) as { page?: CustomPage; error?: string };
      if (!res.ok || !json.page) throw new Error(json.error ?? "Failed to create the tab");
      onCreated(json.page);
      setTitle(""); setSection("");
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to create the tab" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a tab at position {position}</DialogTitle>
          <DialogDescription>Name the tab and choose who sees it. You&apos;ll build its page next.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tab-title">Tab name</Label>
            <Input id="tab-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Notices" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Icon</Label>
              <Select value={iconName} onValueChange={setIconName}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {NAV_ICON_NAMES.map((n) => (
                    <SelectItem key={n} value={n}>
                      <span className="flex items-center gap-2"><NavIcon name={n} className="h-4 w-4" />{n}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tab-section">Section header (optional)</Label>
              <Input id="tab-section" value={section} maxLength={40} onChange={(e) => setSection(e.target.value)} placeholder="Starts a new group" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Shown to</Label>
            <div className="grid gap-2 sm:grid-cols-2 max-h-40 overflow-y-auto rounded-md border p-3">
              {roles.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.has(r)} onCheckedChange={(c) => toggle(r, !!c)} />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void create()} loading={saving}>Create tab</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
