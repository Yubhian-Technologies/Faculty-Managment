"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import type { DisplayNameSettings, DisplayNameSurface } from "@/lib/faculty/displayNameSettings";

// Settings > Website Display Name: one tick per place where a faculty member's Display Name (entered on their own
// profile) is shown instead of their Full Name. The list comes from the server registry (DISPLAY_NAME_SURFACES),
// so every faculty-related place added there appears here by itself.
export function DisplayNameSettingsCard() {
  const [places, setPlaces] = useState<DisplayNameSurface[]>([]);
  const [surfaces, setSurfaces] = useState<DisplayNameSettings>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [filled, setFilled] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/college/settings/display-name", { signal: ctrl.signal, cache: "no-store" })
      .then((r) => {
        // A failed load must not look like "nothing ticked" (Save would then store all-off over the real setting).
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ surfaces?: DisplayNameSettings; places?: DisplayNameSurface[]; filled?: number }>;
      })
      .then((d) => { setPlaces(d.places ?? []); setSurfaces(d.surfaces ?? {}); setFilled(typeof d.filled === "number" ? d.filled : null); })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        toast({ variant: "destructive", title: "Failed to load display name settings" });
      })
      .finally(() => setIsLoading(false));
    return () => ctrl.abort();
  }, []);

  // The places grouped under their faculty module, in registry order.
  const modules = useMemo(() => {
    const byModule = new Map<string, DisplayNameSurface[]>();
    for (const p of places) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
    return Array.from(byModule.entries());
  }, [places]);

  // Each tick is stored the moment it is clicked: the page's own "Save Settings" button does not cover this card,
  // so a tick that waited for a separate Save was silently lost.
  async function toggle(key: string, on: boolean) {
    const before = surfaces;
    const next = { ...surfaces, [key]: on };
    setSurfaces(next);
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/settings/display-name", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surfaces: next }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error);
      }
      toast({ variant: "success", title: "Saved", description: on ? "Display names will be used there." : "The usual name will be used there." });
    } catch (err) {
      setSurfaces(before);
      toast({ variant: "destructive", title: err instanceof Error && err.message ? err.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Website Display Name</CardTitle>
        <CardDescription>
          Tick a faculty module (it saves as soon as you tick) to show each faculty member&apos;s Display Name (surname short form + name, entered on their own profile)
          there instead of their Full Name. Ticking any one place turns the Display Name on in every place. A faculty member who has not entered one keeps their usual name.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <>
            {filled !== null && (
              <p className="text-sm rounded-md bg-muted px-3 py-2">
                {filled === 0
                  ? "No faculty member has entered a Display Name yet, so ticking a place changes nothing until they do (My Profile > Display Name)."
                  : `${filled} faculty member${filled === 1 ? " has" : "s have"} entered a Display Name. Everyone else keeps their usual name.`}
              </p>
            )}
            {modules.map(([module, items]) => (
              <div key={module} className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{module}</p>
                {items.map((p) => (
                  <label key={p.key} className={`flex items-start gap-3 ${p.ready ? "cursor-pointer" : "opacity-60"}`}>
                    <Checkbox
                      className="mt-0.5"
                      checked={p.ready && surfaces[p.key] === true}
                      disabled={!p.ready || isSaving}
                      onCheckedChange={(v) => toggle(p.key, v === true)}
                      aria-label={p.label}
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {p.label}
                        {!p.ready && <Badge variant="outline" className="ml-2 text-[10px] font-normal">Coming soon</Badge>}
                      </span>
                      <span className="block text-xs text-muted-foreground">{p.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
