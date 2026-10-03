"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { roomBenches, roomPerBench } from "@/lib/exams/roomLayout";
import type { ExamRoom } from "@/types/examSeating";

interface RoomForm { name: string; block: string; floor: string; benches: string; studentsPerBench: string }
const EMPTY: RoomForm = { name: "", block: "", floor: "", benches: "", studentsPerBench: "1" };

// Header names accepted in an uploaded sheet (case-insensitive).
const COLUMN_ALIASES: Record<keyof RoomForm, string[]> = {
  name: ["room", "room no", "room number", "classroom", "name"],
  block: ["block", "building"],
  floor: ["floor"],
  benches: ["benches", "no of benches", "number of benches", "capacity", "seats"],
  studentsPerBench: ["students per bench", "per bench", "students/bench", "seats per bench"],
};

function parseCsv(text: string): string[][] {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
}

function rowsToRooms(rows: string[][]): RoomForm[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (key: keyof RoomForm) => header.findIndex((h) => COLUMN_ALIASES[key].includes(h));
  const idx = { name: col("name"), block: col("block"), floor: col("floor"), benches: col("benches"), perBench: col("studentsPerBench") };
  // Students per bench is optional (older sheets: Capacity only = one per bench).
  if ([idx.name, idx.block, idx.floor, idx.benches].some((i) => i < 0)) throw new Error("Sheet needs Room, Block, Floor and Benches columns");
  return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => ({
    name: r[idx.name] ?? "", block: r[idx.block] ?? "", floor: r[idx.floor] ?? "", benches: r[idx.benches] ?? "",
    studentsPerBench: (idx.perBench >= 0 ? r[idx.perBench] : "") || "1",
  }));
}

// College Office keeps the college's classroom list (block, floor, capacity);
// Exam Cell seats students into these when building an exam's seating plan.
export default function ExamRoomsPage() {
  const [rooms, setRooms] = useState<ExamRoom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [form, setForm] = useState<RoomForm>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExamRoom | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    fetch("/api/college/exam-rooms", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ rooms?: ExamRoom[] }>)
      .then((d) => setRooms(d.rooms ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load rooms" }))
      .finally(() => setIsLoading(false));
  }
  useEffect(load, []);

  async function save() {
    setSaving(true);
    try {
      const res = editingId
        ? await fetch(`/api/college/exam-rooms/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: form.name, block: form.block, floor: Number(form.floor), benches: Number(form.benches), studentsPerBench: Number(form.studentsPerBench) }),
          })
        : await fetch("/api/college/exam-rooms", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rooms: [form] }),
          });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save room");
      toast({ variant: "success", title: editingId ? "Room updated" : "Room added" });
      setForm(EMPTY);
      setEditingId(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save room" });
    } finally {
      setSaving(false);
    }
  }

  async function handleFile(file: File) {
    setUploading(true);
    try {
      let rows: string[][];
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/college/parse-excel", { method: "POST", body: fd });
        const data = (await res.json()) as { rows?: string[][]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to read the workbook");
        rows = data.rows ?? [];
      } else {
        rows = parseCsv(await file.text());
      }
      const parsed = rowsToRooms(rows);
      if (parsed.length === 0) throw new Error("No rooms found in the file");
      const res = await fetch("/api/college/exam-rooms", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rooms: parsed }),
      });
      const data = (await res.json()) as { saved?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      toast({ variant: "success", title: `${data.saved} room(s) saved` });
      load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function toggleActive(room: ExamRoom) {
    await fetch(`/api/college/exam-rooms/${room.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !room.isActive }),
    });
    load();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/college/exam-rooms/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE", cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Delete failed (${res.status})`);
      }
      setRooms((list) => list.filter((r) => r.id !== deleteTarget.id));
      toast({ variant: "success", title: `Room ${deleteTarget.name} removed` });
      setDeleteTarget(null);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete room" });
    } finally {
      setDeleting(false);
    }
  }

  const set = (k: keyof RoomForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSave = form.name.trim() && form.block.trim() && form.floor !== "" && Number(form.benches) >= 1;
  const seats = Number(form.benches) * Number(form.studentsPerBench);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exam Rooms"
        description="Classrooms used for exams - block, floor, benches and students per bench. Exam Cell seats students into these."
        actions={
          <>
            <input
              ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
            />
            <Button variant="outline" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" /> Upload CSV / Excel
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-5">
            <div className="space-y-1.5"><Label>Room</Label><Input value={form.name} onChange={set("name")} placeholder="201" /></div>
            <div className="space-y-1.5"><Label>Block</Label><Input value={form.block} onChange={set("block")} placeholder="A" /></div>
            <div className="space-y-1.5"><Label>Floor</Label><Input type="number" value={form.floor} onChange={set("floor")} placeholder="2" /></div>
            <div className="space-y-1.5"><Label>Benches</Label><Input type="number" min={1} value={form.benches} onChange={set("benches")} placeholder="30" /></div>
            <div className="space-y-1.5">
              <Label>Students per bench</Label>
              <Select value={form.studentsPerBench} onValueChange={(v) => setForm((f) => ({ ...f, studentsPerBench: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["1", "2", "3"].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!canSave} loading={saving} onClick={() => void save()}>
              <Plus className="h-4 w-4 mr-1" /> {editingId ? "Update room" : "Add room"}
            </Button>
            {editingId && <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setForm(EMPTY); }}>Cancel</Button>}
            <p className="text-xs text-muted-foreground ml-auto">
              {seats > 0 ? `${seats} seats. ` : ""}Upload columns: Room, Block, Floor, Benches, Students per Bench. Re-uploading updates existing rooms.
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="h-32 rounded-lg border bg-muted/30 animate-pulse" />
      ) : rooms.length === 0 ? (
        <EmptyState title="No rooms yet" description="Add a room above or upload a sheet." />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b">
                <tr><th className="p-3">Room</th><th className="p-3">Block</th><th className="p-3">Floor</th><th className="p-3">Benches</th><th className="p-3">Per bench</th><th className="p-3">Seats</th><th className="p-3">Status</th><th className="p-3" /></tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3">{r.block}</td>
                    <td className="p-3">{r.floor}</td>
                    <td className="p-3">{roomBenches(r)}</td><td className="p-3">{roomPerBench(r)}</td><td className="p-3">{r.capacity}</td>
                    <td className="p-3">
                      <button onClick={() => void toggleActive(r)}>
                        <Badge variant={r.isActive ? "approved" : "outline"}>{r.isActive ? "In use" : "Inactive"}</Badge>
                      </button>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => {
                        setEditingId(r.id);
                        setForm({ name: r.name, block: r.block, floor: String(r.floor), benches: String(roomBenches(r)), studentsPerBench: String(roomPerBench(r)) });
                      }}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setDeleteTarget(r)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Delete room?"
        description={`Room ${deleteTarget?.name ?? ""} will be removed from the list. Seating plans already made keep it.`}
        confirmLabel="Delete"
        loading={deleting}
        variant="destructive"
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
