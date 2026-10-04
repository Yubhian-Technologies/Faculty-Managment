"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Plus, Edit2, Trash2, MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { LocationConfig } from "@/types/locationStaff";

export default function LocationsPage() {
  const [locations, setLocations] = useState<LocationConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", address: "", city: "", state: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadLocations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/location/locations");
      if (res.ok) {
        const d = await res.json() as { locations: LocationConfig[] };
        setLocations(d.locations ?? []);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load gates" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadLocations(); }, [loadLocations]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.city.trim()) {
      toast({ variant: "destructive", title: "Name and city are required" });
      return;
    }
    setIsSubmitting(true);
    try {
      const url = editingId ? `/api/location/locations/${editingId}` : "/api/location/locations";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast({ variant: "success", title: editingId ? "Gate updated" : "Gate created" });
        setIsDialogOpen(false);
        setEditingId(null);
        setForm({ name: "", address: "", city: "", state: "" });
        loadLocations();
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/location/locations/${id}`, { method: "DELETE" });
      if (res.ok) { loadLocations(); toast({ variant: "success", title: "Gate deleted" }); }
    } catch {
      toast({ variant: "destructive", title: "Failed to delete" });
    }
  }

  function openEdit(loc: LocationConfig) {
    setEditingId(loc.id);
    setForm({ name: loc.name ?? "", address: loc.address ?? "", city: loc.city ?? "", state: loc.state ?? "" });
    setIsDialogOpen(true);
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/90 backdrop-blur-sm p-5 sm:p-6 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-3.5">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted/80 shrink-0">
            <Link aria-label="Back" href="/location-staff-admin"><ArrowLeft className="h-5 w-5 text-foreground" /></Link>
          </Button>
          <div>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">Gates</Badge>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <MapPin className="h-6 w-6" /> Gates
            </h1>
          </div>
        </div>
        <Button onClick={() => { setEditingId(null); setForm({ name: "", address: "", city: "", state: "" }); setIsDialogOpen(true); }}><Plus className="h-4 w-4 mr-1.5" /> Add Gate</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-48 rounded-3xl border border-border/50 bg-card/60 animate-pulse" />)}
        </div>
      ) : locations.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center bg-card/40"><Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" /><p className="text-sm text-muted-foreground">No gates configured yet</p></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map((loc) => (
            <Card key={loc.id} className="rounded-3xl border-border/60 shadow-xs hover:shadow-md transition-all">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary shrink-0" />
                    <h3 className="font-bold text-foreground">{loc.name}</h3>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(loc)}><Edit2 className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(loc.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {loc.city && <p><span className="font-medium text-foreground">City:</span> {loc.city}</p>}
                  {loc.state && <p><span className="font-medium text-foreground">State:</span> {loc.state}</p>}
                  {loc.address && <p className="line-clamp-2">{loc.address}</p>}
                </div>
                <Badge variant={loc.isActive ? "default" : "outline"} className={loc.isActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-muted text-muted-foreground"}>{loc.isActive ? "Active" : "Inactive"}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Edit Gate" : "Add Gate"}</DialogTitle><DialogDescription>Gates are the places staff must report to.</DialogDescription></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2"><Label>Gate Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Main Gate" required /></div>
            <div className="space-y-2"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" /></div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>City *</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required /></div><div className="space-y-2"><Label>State</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (editingId ? "Update" : "Create")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
