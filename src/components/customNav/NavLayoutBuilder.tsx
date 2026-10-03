"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { NavIcon } from "@/components/layout/NavIcon";
import { AddTabDialog } from "./AddTabDialog";
import {
  getNavItemsForRole, isProfileNavItem, isSettingsNavItem, computeItemModule,
} from "@/components/layout/navConfig";
import { useAdminColleges } from "@/hooks/useAdminColleges";
import { toast } from "@/hooks/useToast";
import { CUSTOMIZABLE_ROLES } from "@/lib/customNav/roles";
import { buildRows, insertRow, mergeHidden, moveRow, toOrder, type BuilderRow } from "@/lib/customNav/builderModel";
import { ROLE_LABELS, customPageHref } from "@/types";
import type { CustomNavLayout, CustomPage, CustomPageSummary, NavVisibilitySettings, UserRole } from "@/types";


const json = (body: unknown) => ({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function NavLayoutBuilder() {
  const { data: colleges = [] } = useAdminColleges();
  // The first college until one is picked (derived, not set in an effect).
  const [pickedCollege, setCollegeId] = useState("");
  const collegeId = pickedCollege || colleges[0]?.id || "";
  const [role, setRole] = useState<UserRole>("HOD");
  const [rows, setRows] = useState<BuilderRow[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [savedKey, setSavedKey] = useState("");
  const [visibility, setVisibility] = useState<NavVisibilitySettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addAt, setAddAt] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BuilderRow | null>(null);

  // Built-in tabs that can appear in a sidebar (the top-bar Profile / Settings entries never do).
  const builtIn = useMemo(
    () => getNavItemsForRole(role).filter((i) => !isProfileNavItem(i) && !isSettingsNavItem(i)),
    [role]
  );
  // Tabs hidden through a whole-module switch in Settings - shown, but not toggleable here.
  const moduleHidden = useMemo(() => {
    const mods = new Set(visibility?.hiddenModules?.[role] ?? []);
    const all = getNavItemsForRole(role);
    const out = new Set<string>();
    all.forEach((item, i) => { if (mods.has(computeItemModule(all, i))) out.add(item.href); });
    return out;
  }, [visibility, role]);

  const keyOf = (rs: BuilderRow[], h: Set<string>) => JSON.stringify([rs.map((r) => r.href), Array.from(h).sort()]);

  const load = useCallback(async () => {
    if (!collegeId) return;
    setLoading(true);
    try {
      const [navRes, visRes] = await Promise.all([
        fetch(`/api/admin/custom-nav?collegeId=${collegeId}`, { cache: "no-store" }),
        fetch(`/api/admin/settings/nav-visibility?collegeId=${collegeId}`, { cache: "no-store" }),
      ]);
      if (!navRes.ok || !visRes.ok) throw new Error();
      const nav = (await navRes.json()) as { pages: CustomPageSummary[]; layout: CustomNavLayout };
      const vis = (await visRes.json()) as { settings: NavVisibilitySettings };
      const nextRows = buildRows(role, builtIn, nav.pages, nav.layout.order[role]);
      const nextHidden = new Set(vis.settings.hiddenItems?.[role] ?? []);
      setVisibility(vis.settings);
      setRows(nextRows);
      setHidden(nextHidden);
      setSavedKey(keyOf(nextRows, nextHidden));
    } catch {
      toast({ variant: "destructive", title: "Failed to load this college's navigation" });
    } finally {
      setLoading(false);
    }
  }, [collegeId, role, builtIn]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const dirty = keyOf(rows, hidden) !== savedKey;

  function moveTo(from: number, to: number) { setRows((rs) => moveRow(rs, from, to)); }
  function toggleHidden(href: string) {
    setHidden((prev) => { const n = new Set(prev); if (n.has(href)) n.delete(href); else n.add(href); return n; });
  }

  async function saveOrder(nextRows: BuilderRow[]) {
    const res = await fetch("/api/admin/custom-nav", json({ collegeId, role, order: toOrder(nextRows) }));
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed to save the order");
  }

  async function save() {
    setSaving(true);
    try {
      await saveOrder(rows);
      const res = await fetch("/api/admin/settings/nav-visibility", json({
        collegeId, role,
        hiddenModules: visibility?.hiddenModules?.[role] ?? [],
        hiddenItems: mergeHidden(visibility?.hiddenItems?.[role] ?? [], rows.map((r) => r.href), hidden),
      }));
      if (!res.ok) throw new Error("Failed to save visibility");
      toast({ variant: "success", title: "Navigation saved", description: `${ROLE_LABELS[role]} sidebar updated for this college.` });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  async function onCreated(page: CustomPage) {
    const row: BuilderRow = { href: customPageHref(page.id), label: page.title, iconName: page.iconName, module: page.section ?? "", kind: "custom", pageId: page.id, enabled: page.enabled };
    const next = insertRow(rows, (addAt ?? rows.length), row);
    setAddAt(null);
    setRows(next);
    try {
      // Persist the position straight away so the new tab isn't orphaned if the editor is opened next.
      await saveOrder(next);
      setSavedKey((k) => (k === keyOf(rows, hidden) ? keyOf(next, hidden) : k));
      toast({ variant: "success", title: "Tab added", description: "Now build its page." });
    } catch {
      toast({ variant: "destructive", title: "Tab created, but its position wasn't saved", description: "Press Save to store the order." });
    }
  }

  async function deletePage() {
    const target = deleteTarget;
    if (!target?.pageId) return;
    setDeleteTarget(null);
    const res = await fetch(`/api/admin/custom-nav/pages/${target.pageId}?collegeId=${collegeId}`, { method: "DELETE" });
    if (!res.ok) { toast({ variant: "destructive", title: "Failed to delete the tab" }); return; }
    toast({ variant: "success", title: "Tab deleted" });
    await load();
  }

  const customRoles = CUSTOMIZABLE_ROLES;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dashboard tabs</CardTitle>
        <CardDescription>
          Number, reorder, show or hide the tabs in a role&apos;s sidebar for one college, and add your own tabs with custom pages. Built-in tabs
          can be moved and switched off but not edited.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>College</Label>
            <Select value={collegeId} onValueChange={setCollegeId}>
              <SelectTrigger><SelectValue placeholder="Select a college" /></SelectTrigger>
              <SelectContent>{colleges.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CUSTOMIZABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {dirty && <p className="text-sm text-amber-700">You have unsaved changes.</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ol className="space-y-1">
            <AddSlot onClick={() => setAddAt(0)} label="Add a tab at the top" />
            {rows.map((row, i) => {
              const off = hidden.has(row.href) || moveModuleHidden(moduleHidden, row);
              return (
                <Fragment key={row.href}>
                  <li className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${off ? "bg-muted/40 text-muted-foreground" : "bg-card"}`}>
                    <PositionInput value={i + 1} max={rows.length} onMove={(n) => moveTo(i, n - 1)} />
                    <NavIcon name={row.iconName} className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.label}</span>
                    {row.module && <Badge variant="outline" className="hidden sm:inline-flex max-w-32 truncate">{row.module}</Badge>}
                    {row.kind === "custom" && <Badge>Custom</Badge>}
                    {row.kind === "custom" && row.enabled === false && <Badge variant="secondary">Page off</Badge>}
                    {moveModuleHidden(moduleHidden, row) && <Badge variant="secondary" title="Hidden by a whole-module switch in Settings → Navigation Visibility">Module hidden</Badge>}
                    <div className="flex items-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} aria-label="Move up" onClick={() => moveTo(i, i - 1)}><ArrowUp className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === rows.length - 1} aria-label="Move down" onClick={() => moveTo(i, i + 1)}><ArrowDown className="h-4 w-4" /></Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        disabled={moveModuleHidden(moduleHidden, row)}
                        aria-label={hidden.has(row.href) ? "Show this tab" : "Hide this tab"}
                        title={hidden.has(row.href) ? "Hidden - click to show" : "Shown - click to hide"}
                        onClick={() => toggleHidden(row.href)}
                      >
                        {hidden.has(row.href) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      {row.kind === "custom" && row.pageId && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7" asChild aria-label="Edit page">
                            <Link href={`/super-admin/customize/pages/${row.pageId}?collegeId=${collegeId}`}><Pencil className="h-4 w-4" /></Link>
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Delete tab" onClick={() => setDeleteTarget(row)}><Trash2 className="h-4 w-4" /></Button>
                        </>
                      )}
                    </div>
                  </li>
                  <AddSlot onClick={() => setAddAt(i + 1)} label={`Add a tab at position ${i + 2}`} />
                </Fragment>
              );
            })}
          </ol>
        )}

        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving} disabled={!dirty || loading}>
            <Save className="h-4 w-4 mr-2" />Save changes
          </Button>
        </div>
      </CardContent>

      {addAt !== null && (
        <AddTabDialog
          open
          onOpenChange={(o) => { if (!o) setAddAt(null); }}
          collegeId={collegeId}
          role={role}
          roles={customRoles}
          position={addAt + 1}
          onCreated={(p) => void onCreated(p)}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title={`Delete "${deleteTarget?.label ?? ""}"?`}
        description="The tab and its page are removed for every role at this college. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void deletePage()}
      />
    </Card>
  );
}

function moveModuleHidden(set: Set<string>, row: BuilderRow) {
  return row.kind === "builtin" && set.has(row.href);
}

function AddSlot({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <li className="flex justify-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className="group flex h-5 w-full items-center justify-center rounded text-muted-foreground/40 hover:bg-primary/5 hover:text-primary focus-visible:text-primary"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

// The tab's number; edit it to move the tab straight to that position.
function PositionInput({ value, max, onMove }: { value: number; max: number; onMove: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Math.round(Number(draft));
    setDraft(null);
    if (Number.isFinite(n) && n >= 1 && n !== value) onMove(Math.min(max, n));
  };
  return (
    <Input
      type="number" inputMode="numeric" min={1} max={max}
      value={draft ?? String(value)}
      aria-label={`Position ${value}`}
      className="h-7 w-14 px-1.5 text-center text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(null); }}
    />
  );
}
