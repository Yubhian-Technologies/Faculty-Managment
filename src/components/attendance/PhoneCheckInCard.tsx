"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Smartphone, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { warmFaceModels } from "@/lib/attendance/faceMatch";
import { PasskeyAttendanceDialog } from "@/components/attendance/PasskeyAttendanceDialog";

// On every self-attendance page (faculty, HOD, Principal / VP, staff):
//  - warms the face models up while the page is open, when the college uses the face scan, so tapping Check In
//    starts the camera straight away (the dialog itself is only mounted on the tap);
//  - when the college allows phone check-in (Self Check-In Method PASSKEY / EITHER): this person's registered
//    phones, Register This Phone and Remove.

interface Phone { id: string; label: string; createdAt: string | null; lastUsedAt: string | null }

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "never";
}

function fetchPhones(): Promise<{ method: "FACE" | "PASSKEY" | "EITHER"; passkeys: Phone[] } | null> {
  return fetch("/api/college/attendance/passkey")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null); // the card simply stays hidden
}

export function PhoneCheckInCard({ onChanged }: { onChanged?: () => void }) {
  const [method, setMethod] = useState<"FACE" | "PASSKEY" | "EITHER" | null>(null);
  const [phones, setPhones] = useState<Phone[]>([]);
  const [registering, setRegistering] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(() => fetchPhones().then((d) => {
    if (!d) return;
    setMethod(d.method);
    setPhones(d.passkeys ?? []);
  }), []);
  useEffect(() => { void load(); }, [load]);

  // Face models: downloaded and compiled while the browser is idle.
  useEffect(() => {
    if (method !== "FACE" && method !== "EITHER") return;
    const warm = () => { void warmFaceModels().catch(() => undefined); };
    const w = window as Window & { requestIdleCallback?: (f: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(warm); else setTimeout(warm, 1200);
  }, [method]);

  async function remove(p: Phone) {
    setRemoving(p.id);
    try {
      const r = await fetch(`/api/college/attendance/passkey?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Unable to remove the phone.");
      toast({ title: "Phone removed." });
      await load();
      onChanged?.();
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setRemoving(null);
    }
  }

  if (method !== "PASSKEY" && method !== "EITHER") return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Fingerprint className="h-4 w-4" />Phone Check-In</CardTitle>
        <p className="text-sm text-muted-foreground">
          {method === "PASSKEY"
            ? "Your college checks in with your phone's own fingerprint or face unlock. Register the phone you carry every day."
            : "You can check in with your phone's own fingerprint or face unlock instead of the face scan. Register the phone you carry every day."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {phones.length === 0 ? (
          <p className="text-sm text-muted-foreground">No phone registered yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {phones.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.label}</p>
                  <p className="text-xs text-muted-foreground">Registered {when(p.createdAt)} · last used {when(p.lastUsedAt)}</p>
                </div>
                <Button variant="ghost" size="sm" aria-label={`Remove ${p.label}`} disabled={removing === p.id} onClick={() => void remove(p)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant={phones.length ? "outline" : "default"} onClick={() => setRegistering(true)}>
          <Fingerprint className="h-4 w-4 mr-1.5" />Register This Phone
        </Button>
      </CardContent>
      {registering && (
        <PasskeyAttendanceDialog
          mode="register"
          open
          onOpenChange={(o) => { if (!o) setRegistering(false); }}
          onSuccess={() => { void load(); onChanged?.(); }}
        />
      )}
    </Card>
  );
}
