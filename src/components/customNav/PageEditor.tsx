"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NavIcon, NAV_ICON_NAMES } from "@/components/layout/NavIcon";
import { BlockRenderer } from "./BlockRenderer";
import { toast } from "@/hooks/useToast";
import { CUSTOMIZABLE_ROLES } from "@/lib/customNav/roles";
import { isSafeHref, isSafeImageUrl } from "@/lib/customNav/safeUrl";
import { moveRow } from "@/lib/customNav/builderModel";
import { ROLE_LABELS } from "@/types";
import type { CustomPage, CustomPageBlock, CustomPageBlockType, UserRole } from "@/types";


const BLOCK_LABELS: Record<CustomPageBlockType, string> = {
  heading: "Heading", text: "Text", button: "Button", image: "Image", divider: "Divider", linkList: "Link list", infoCard: "Info card",
};

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function blank(type: CustomPageBlockType): CustomPageBlock {
  const id = newId();
  switch (type) {
    case "heading": return { id, type, text: "", level: 2 };
    case "text": return { id, type, text: "" };
    case "button": return { id, type, label: "", href: "", variant: "primary" };
    case "image": return { id, type, url: "", alt: "" };
    case "divider": return { id, type };
    case "linkList": return { id, type, title: "", links: [{ label: "", href: "" }] };
    case "infoCard": return { id, type, title: "", body: "", tone: "info" };
  }
}

/** Problems with a block, in plain words - empty when it is ready to save. */
function blockProblem(b: CustomPageBlock): string | null {
  switch (b.type) {
    case "heading": case "text": return b.text.trim() ? null : "Add some text";
    case "button":
      if (!b.label.trim()) return "Give the button a label";
      return isSafeHref(b.href) ? null : "Use an in-app path like /hod/faculty or an http(s) link";
    case "image": return isSafeImageUrl(b.url) ? null : "Image needs an http(s) URL";
    case "divider": return null;
    case "linkList":
      if (b.links.length === 0) return "Add at least one link";
      return b.links.every((l) => l.label.trim() && isSafeHref(l.href)) ? null : "Every link needs a label and a valid address";
    case "infoCard": return b.title.trim() && b.body.trim() ? null : "Add a title and some text";
  }
}

export function PageEditor({ collegeId, pageId }: { collegeId: string; pageId: string }) {
  const [page, setPage] = useState<CustomPage | null>(null);
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/custom-nav/pages/${pageId}?collegeId=${collegeId}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const p = ((await res.json()) as { page: CustomPage }).page;
      setPage(p);
      setSaved(JSON.stringify(p));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [collegeId, pageId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const dirty = page ? JSON.stringify(page) !== saved : false;
  const problems = useMemo(() => (page ? page.blocks.map(blockProblem) : []), [page]);
  const blocked = problems.some(Boolean) || !page?.title.trim() || (page?.roles.length ?? 0) === 0;

  function patch(p: Partial<CustomPage>) { setPage((cur) => (cur ? { ...cur, ...p } : cur)); }
  function setBlock(i: number, b: CustomPageBlock) { setPage((cur) => (cur ? { ...cur, blocks: cur.blocks.map((x, j) => (j === i ? b : x)) } : cur)); }
  function addBlock(type: CustomPageBlockType) { setPage((cur) => (cur ? { ...cur, blocks: [...cur.blocks, blank(type)] } : cur)); }
  function removeBlock(i: number) { setPage((cur) => (cur ? { ...cur, blocks: cur.blocks.filter((_, j) => j !== i) } : cur)); }
  function shiftBlock(i: number, to: number) { setPage((cur) => (cur ? { ...cur, blocks: moveRow(cur.blocks, i, to) } : cur)); }

  async function save() {
    if (!page) return;
    setSaving(true);
    try {
      const { title, iconName, section, roles, enabled, blocks } = page;
      const res = await fetch(`/api/admin/custom-nav/pages/${pageId}?collegeId=${collegeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, iconName, section: section ?? "", roles, enabled, blocks }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed to save");
      setSaved(JSON.stringify(page));
      toast({ variant: "success", title: "Page saved" });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !page) return <p className="text-sm text-destructive">This page could not be loaded. It may have been deleted.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" asChild><Link href="/super-admin/customize"><ArrowLeft className="h-4 w-4 mr-2" />Back to tabs</Link></Button>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-sm text-amber-700">Unsaved changes</span>}
          <Button onClick={() => void save()} loading={saving} disabled={!dirty || blocked}><Save className="h-4 w-4 mr-2" />Save page</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Tab settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="pg-title">Tab name</Label>
              <Input id="pg-title" value={page.title} maxLength={60} onChange={(e) => patch({ title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Icon</Label>
              <Select value={page.iconName} onValueChange={(v) => patch({ iconName: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {NAV_ICON_NAMES.map((n) => <SelectItem key={n} value={n}><span className="flex items-center gap-2"><NavIcon name={n} className="h-4 w-4" />{n}</span></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-section">Section header</Label>
              <Input id="pg-section" value={page.section ?? ""} maxLength={40} onChange={(e) => patch({ section: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Page enabled</p>
              <p className="text-xs text-muted-foreground">Off removes the tab and blocks the page for everyone, without deleting it.</p>
            </div>
            <Switch checked={page.enabled} onCheckedChange={(c) => patch({ enabled: c })} aria-label="Page enabled" />
          </div>
          <div className="space-y-1.5">
            <Label>Shown to</Label>
            <div className="grid gap-2 sm:grid-cols-3 max-h-40 overflow-y-auto rounded-md border p-3">
              {CUSTOMIZABLE_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={page.roles.includes(r)}
                    onCheckedChange={(c) => patch({ roles: c ? [...page.roles, r] : page.roles.filter((x) => x !== r) })}
                  />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Per-role on/off for this tab also lives on the Dashboard tabs screen (the eye icon).</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Content</CardTitle>
            <Select value="" onValueChange={(v) => addBlock(v as CustomPageBlockType)}>
              <SelectTrigger className="w-40"><span className="flex items-center gap-1.5"><Plus className="h-4 w-4" />Add block</span></SelectTrigger>
              <SelectContent>
                {(Object.keys(BLOCK_LABELS) as CustomPageBlockType[]).map((t) => <SelectItem key={t} value={t}>{BLOCK_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="space-y-3">
            {page.blocks.length === 0 && <p className="text-sm text-muted-foreground">No blocks yet. Use “Add block”.</p>}
            {page.blocks.map((b, i) => (
              <div key={b.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i + 1}. {BLOCK_LABELS[b.type]}</span>
                  <div className="flex">
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} aria-label="Move block up" onClick={() => shiftBlock(i, i - 1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === page.blocks.length - 1} aria-label="Move block down" onClick={() => shiftBlock(i, i + 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Delete block" onClick={() => removeBlock(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <BlockFields block={b} onChange={(nb) => setBlock(i, nb)} />
                {problems[i] && <p className="text-xs text-destructive">{problems[i]}</p>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader><CardTitle className="text-base">Preview</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xl font-bold mb-4 break-words">{page.title || "Untitled"}</p>
            <BlockRenderer blocks={page.blocks.filter((_, i) => !problems[i])} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BlockFields({ block, onChange }: { block: CustomPageBlock; onChange: (b: CustomPageBlock) => void }) {
  switch (block.type) {
    case "heading":
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
          <Input value={block.text} maxLength={200} placeholder="Heading text" onChange={(e) => onChange({ ...block, text: e.target.value })} />
          <Select value={String(block.level)} onValueChange={(v) => onChange({ ...block, level: Number(v) as 1 | 2 | 3 })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="1">Large</SelectItem><SelectItem value="2">Medium</SelectItem><SelectItem value="3">Small</SelectItem></SelectContent>
          </Select>
        </div>
      );
    case "text":
      return <Textarea value={block.text} rows={4} maxLength={5000} placeholder="Write something…" onChange={(e) => onChange({ ...block, text: e.target.value })} />;
    case "button":
      return (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={block.label} maxLength={80} placeholder="Button label" onChange={(e) => onChange({ ...block, label: e.target.value })} />
            <Input value={block.href} placeholder="/hod/faculty or https://…" onChange={(e) => onChange({ ...block, href: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Select value={block.variant} onValueChange={(v) => onChange({ ...block, variant: v as "primary" | "outline" })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="primary">Filled</SelectItem><SelectItem value="outline">Outline</SelectItem></SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!block.newTab} onCheckedChange={(c) => onChange({ ...block, newTab: !!c })} />Open in new tab</label>
          </div>
        </div>
      );
    case "image":
      return (
        <div className="space-y-2">
          <Input value={block.url} placeholder="https://… image address" onChange={(e) => onChange({ ...block, url: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={block.alt} maxLength={200} placeholder="Describe the image (for screen readers)" onChange={(e) => onChange({ ...block, alt: e.target.value })} />
            <Input value={block.caption ?? ""} maxLength={300} placeholder="Caption (optional)" onChange={(e) => onChange({ ...block, caption: e.target.value })} />
          </div>
        </div>
      );
    case "divider":
      return <p className="text-xs text-muted-foreground">A horizontal line.</p>;
    case "linkList":
      return (
        <div className="space-y-2">
          <Input value={block.title ?? ""} maxLength={120} placeholder="List title (optional)" onChange={(e) => onChange({ ...block, title: e.target.value })} />
          {block.links.map((l, j) => (
            <div key={j} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input value={l.label} maxLength={120} placeholder="Label" onChange={(e) => onChange({ ...block, links: block.links.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })} />
              <Input value={l.href} placeholder="/path or https://…" onChange={(e) => onChange({ ...block, links: block.links.map((x, k) => (k === j ? { ...x, href: e.target.value } : x)) })} />
              <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" aria-label="Remove link" disabled={block.links.length === 1} onClick={() => onChange({ ...block, links: block.links.filter((_, k) => k !== j) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" disabled={block.links.length >= 30} onClick={() => onChange({ ...block, links: [...block.links, { label: "", href: "" }] })}><Plus className="h-4 w-4 mr-1" />Add link</Button>
        </div>
      );
    case "infoCard":
      return (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
            <Input value={block.title} maxLength={120} placeholder="Title" onChange={(e) => onChange({ ...block, title: e.target.value })} />
            <Select value={block.tone} onValueChange={(v) => onChange({ ...block, tone: v as "info" | "success" | "warning" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent>
            </Select>
          </div>
          <Textarea value={block.body} rows={3} maxLength={2000} placeholder="Message" onChange={(e) => onChange({ ...block, body: e.target.value })} />
        </div>
      );
  }
}
