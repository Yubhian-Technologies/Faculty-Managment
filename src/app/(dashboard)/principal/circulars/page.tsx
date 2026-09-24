"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { CircularCard } from "@/components/circular/CircularCard";
import { CircularForm } from "@/components/circular/CircularForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import type { Circular } from "@/types/circular";
import { toast } from "@/hooks/useToast";

export default function PrincipalCircularsPage() {
  const router = useRouter();
  const [circulars, setCirculars] = useState<Circular[]>([]);
  const [messageFromOptions, setMessageFromOptions] = useState<string[]>([]);
  const [newOption, setNewOption] = useState("");
  const [allowedUids, setAllowedUids] = useState("");
  const [allowedRoles, setAllowedRoles] = useState("");

  async function load() {
    const [c, s, p] = await Promise.all([
      fetch("/api/college/circulars").then((r) => r.json()),
      fetch("/api/college/circular-settings").then((r) => r.json()),
      fetch("/api/college/circular-permissions").then((r) => r.json()),
    ]);
    setCirculars(c.circulars ?? []);
    setMessageFromOptions(s.settings?.messageFromOptions ?? []);
    setAllowedUids((p.permissions?.allowedUids ?? []).join(", "));
    setAllowedRoles((p.permissions?.allowedRoles ?? []).join(", "));
  }
  useEffect(() => { void load(); }, []);

  async function saveSettings() {
    const opts = messageFromOptions;
    const res = await fetch("/api/college/circular-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageFromOptions: opts }) });
    if (!res.ok) toast({ variant: "destructive", title: "Failed to save settings" });
    else toast({ variant: "success", title: "Settings saved" });
  }
  async function savePerms() {
    const uids = allowedUids.split(",").map((s) => s.trim()).filter(Boolean);
    const roles = allowedRoles.split(",").map((s) => s.trim()).filter(Boolean);
    const res = await fetch("/api/college/circular-permissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowedUids: uids, allowedRoles: roles }) });
    if (!res.ok) toast({ variant: "destructive", title: "Failed to save permissions" });
    else toast({ variant: "success", title: "Permissions saved" });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Circulars" description="Create, publish and manage circulars. Published circulars are notified to the selected audience." />

      <CircularForm onCreated={() => void load()} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Settings — Message From options (Principal)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {messageFromOptions.map((o) => (
                <span key={o} className="rounded border px-2 py-1 text-sm">{o} <button onClick={() => setMessageFromOptions((prev) => prev.filter((x) => x !== o))} className="ml-2 text-destructive">×</button></span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newOption} onChange={(e) => setNewOption(e.target.value)} placeholder="Add new sender (e.g. Vice Principal)" />
              <Button variant="outline" onClick={() => { if (newOption.trim()) { setMessageFromOptions((p) => [...p, newOption.trim()]); setNewOption(""); } }}>Add</Button>
            </div>
            <Button onClick={() => void saveSettings()}>Save Settings</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">RBAC — Who can send circulars</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>Allowed UIDs (comma separated HOD/faculty uids)</Label><Input value={allowedUids} onChange={(e) => setAllowedUids(e.target.value)} placeholder="uid1, uid2" /></div>
            <div><Label>Allowed Roles (comma separated, e.g. HOD,PANEL_MEMBER)</Label><Input value={allowedRoles} onChange={(e) => setAllowedRoles(e.target.value)} placeholder="HOD" /></div>
            <p className="text-xs text-muted-foreground">Principal/Vice Principal always allowed. Add HOD or specific faculty UIDs to delegate.</p>
            <Button onClick={() => void savePerms()}>Save Permissions</Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {circulars.map((c) => (
          <CircularCard
            key={c.id}
            circular={c}
            canPublish={c.status === "DRAFT"}
            onOpen={() => router.push(`/circulars/${c.id}`)}
            onPublish={async () => {
              const res = await fetch(`/api/college/circulars/${c.id}/publish`, { method: "POST" });
              if (!res.ok) toast({ variant: "destructive", title: "Publish failed" });
              else { toast({ variant: "success", title: "Published" }); void load(); }
            }}
          />
        ))}
      </div>
      {circulars.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No circulars yet.</CardContent></Card>}
    </div>
  );
}
