"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

// Part of the Attendance Timings card: how faculty and staff check themselves in (settings/selfCheckIn).
type Method = "FACE" | "PASSKEY" | "EITHER";
const OPTIONS: { value: Method; title: string; text: string }[] = [
  { value: "FACE", title: "Face Scan", text: "The camera scan of the registered face (as before)." },
  { value: "PASSKEY", title: "Phone Unlock", text: "One tap and the registered phone's own fingerprint or face unlock. Fast; can't be faked by a script." },
  { value: "EITHER", title: "Either", text: "Phone unlock for those who registered a phone, the face scan for everyone else." },
];

export function SelfCheckInMethodSection() {
  const [saved, setSaved] = useState<Method | null>(null);
  const [picked, setPicked] = useState<Method | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/college/settings/self-check-in")
      .then((r) => (r.ok ? r.json() : null) as Promise<{ method?: Method } | null>)
      .then((d) => { if (d?.method) { setSaved(d.method); setPicked(d.method); } })
      .catch(() => undefined);
  }, []);

  async function save() {
    if (!picked) return;
    setBusy(true);
    try {
      const r = await fetch("/api/college/settings/self-check-in", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: picked }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Unable to save the check-in method.");
      setSaved(picked);
      toast({ title: "Check-in method saved." });
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!saved) return null;
  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <Label>Self Check-In Method</Label>
        <p className="text-xs text-muted-foreground mt-0.5">How faculty and staff check themselves in and out. The campus location check applies to every method.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.value} type="button" onClick={() => setPicked(o.value)}
            className={cn("rounded-lg border p-3 text-left transition-colors", picked === o.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}
          >
            <p className="text-sm font-medium">{o.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{o.text}</p>
          </button>
        ))}
      </div>
      {picked === "PASSKEY" && saved !== "PASSKEY" && (
        <p className="text-xs text-amber-700">Everyone will need to register their phone (My Attendance &gt; Phone Check-In) before their next check-in. &ldquo;Either&rdquo; lets people move over gradually.</p>
      )}
      <Button variant="outline" onClick={() => void save()} loading={busy} disabled={picked === saved}>Save Method</Button>
    </div>
  );
}
