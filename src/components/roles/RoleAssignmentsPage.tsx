"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, History, Mail, Plus, Trash2, UserCog, UserMinus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { PRIMARY_ROLE_CHOICES, SEAT_ROLES, canAssignSeat, canHoldSeat, isSingletonSeatRole, roleMatchesSeat, seatNeedsDepartment } from "@/lib/roles/seatRoles";
import { cn, formatDate } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { LEVEL_LABELS, ROLE_LABELS, ROLE_LEVEL, type UserRole } from "@/types/core";
import type { OutgoingHolderAction, RoleSeat, RoleSeatHistoryEntry } from "@/types/roleSeats";

interface Person { uid: string; name: string; email: string; role: string; storedRole?: string; department: string }
interface Dept { id: string; name: string }

// Role Assignments: who sits in each seat (Principal, a department's HOD, Vice
// Principal, Academics, R&D head, ...). Appointing someone adds that seat's modules
// to their own dashboard; changing the holder moves the seat - and all the
// history that hangs off it - to the new person without deleting anything.
// See types/roleSeats.ts. `collegeId` is only for Super Admin / Management /
// Administration, who manage a college other than their own.
export function RoleAssignmentsPage({ collegeId }: { collegeId?: string }) {
  const user = useAuthStore((s) => s.user);
  const [seats, setSeats] = useState<RoleSeat[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const qs = collegeId ? `?collegeId=${encodeURIComponent(collegeId)}` : "";
  const canAssign = useCallback(() => !!user && canAssignSeat(user), [user]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/college/role-seats${qs}`);
      const data = await res.json() as { seats?: RoleSeat[]; people?: Person[]; departments?: Dept[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setSeats(data.seats ?? []);
      setPeople(data.people ?? []);
      setDepartments(data.departments ?? []);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load role assignments" });
    } finally {
      setIsLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  const visibleSeats = useMemo(() => seats.filter((s) => s.role !== "ACCOUNTS"), [seats]);

  const grouped = useMemo(() => {
    const map = new Map<number, RoleSeat[]>();
    for (const s of visibleSeats) {
      const level = ROLE_LEVEL[s.role] ?? 9;
      map.set(level, [...(map.get(level) ?? []), s]);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [visibleSeats]);

  const [addOpen, setAddOpen] = useState(false);
  const [assignSeat, setAssignSeat] = useState<RoleSeat | null>(null);
  const [historySeat, setHistorySeat] = useState<RoleSeat | null>(null);
  const [emailSeat, setEmailSeat] = useState<RoleSeat | null>(null);
  const [vacateSeat, setVacateSeat] = useState<RoleSeat | null>(null);
  const [removeSeat, setRemoveSeat] = useState<RoleSeat | null>(null);

  async function patchSeat(id: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; code?: string }> {
    const res = await fetch(`/api/college/role-seats/${id}${qs}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json() as { error?: string; code?: string };
    return res.ok ? { ok: true } : { ok: false, error: data.error, code: data.code };
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Role Assignments"
        description="Appoint people to roles - Principal, each department's HOD, Vice Principal, Academics and so on. Everyone signs in with their own college email; a role adds its modules to their dashboard and stays with the position when the person changes."
        actions={
          <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Role</Button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : visibleSeats.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              No seats yet. Add a seat and appoint someone to get started.
            </p>
            <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Role</Button>
          </CardContent>
        </Card>
      ) : (
        grouped.map(([level, levelSeats]) => (
          <div key={level} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {LEVEL_LABELS[level as keyof typeof LEVEL_LABELS] ?? `Level ${level}`}
            </p>
            <div className="space-y-2">
              {levelSeats.map((seat) => (
                <Card key={seat.id}>
                  <CardContent className="p-4 flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{seat.label}</p>
                        {seat.legacyUid && seat.holderUid === seat.legacyUid && (
                          <Badge variant="outline" className="text-[10px]">Existing role account</Badge>
                        )}
                      </div>
                      <p className="text-sm">
                        {seat.holderUid
                          ? <>{seat.holderName}{seat.holderSince && <span className="text-muted-foreground"> · since {formatDate(seat.holderSince)}</span>}</>
                          : <span className="text-amber-600">Vacant</span>}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        {seat.roleEmail ? seat.roleEmail : "No role email set"}
                        <span className="text-[10px]">(contact address, not a login)</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {canAssign() && (
                        <Button size="sm" onClick={() => setAssignSeat(seat)}>
                          <UserCog className="h-3.5 w-3.5 mr-1" />{seat.holderUid ? "Change" : "Assign"}
                        </Button>
                      )}
                      {canAssign() && seat.holderUid && (
                        <Button size="sm" variant="ghost" onClick={() => setVacateSeat(seat)}>
                          <UserMinus className="h-3.5 w-3.5 mr-1" />Vacate
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEmailSeat(seat)}>Role email</Button>
                      <Button size="sm" variant="ghost" onClick={() => setHistorySeat(seat)}>
                        <History className="h-3.5 w-3.5 mr-1" />History
                      </Button>
                      {/* Offered on every seat so the action is discoverable,
                          but an occupied seat can't be deleted - the server
                          refuses it (deactivateSeat: "Empty the seat before
                          removing it") because the holder would silently lose
                          the role. Disabled with the reason rather than hidden,
                          which is why it previously looked absent. */}
                      {canAssign() && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={!!seat.holderUid}
                          title={seat.holderUid ? "Vacate this role first, then delete it" : undefined}
                          onClick={() => setRemoveSeat(seat)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      <AddSeatDialog
        open={addOpen} onOpenChange={setAddOpen} qs={qs} departments={departments} seats={seats}
        canCreate={canAssign} onDone={load}
      />
      <AssignDialog
        seat={assignSeat} onClose={() => setAssignSeat(null)} people={people}
        patchSeat={patchSeat} onDone={load}
      />
      <HistoryDialog seat={historySeat} onClose={() => setHistorySeat(null)} qs={qs} />
      <RoleEmailDialog seat={emailSeat} onClose={() => setEmailSeat(null)} patchSeat={patchSeat} onDone={load} />

      <VacateDialog seat={vacateSeat} onClose={() => setVacateSeat(null)} people={people} patchSeat={patchSeat} onDone={load} />
      <ConfirmDialog
        open={removeSeat !== null}
        onOpenChange={(o) => { if (!o) setRemoveSeat(null); }}
        title="Delete this role?"
        description={removeSeat ? `"${removeSeat.label}" will be deleted. Its history is kept.` : undefined}
        confirmLabel="Delete" variant="destructive"
        onConfirm={async () => {
          if (!removeSeat) return;
          const r = await patchSeat(removeSeat.id, { action: "REMOVE" });
          if (!r.ok) toast({ variant: "destructive", title: r.error ?? "Failed" });
          else { toast({ variant: "success", title: "Role deleted" }); setRemoveSeat(null); await load(); }
        }}
      />
    </div>
  );
}

// ─── Outgoing holder (existing role account) ────────────────────────────────
// When the seat's current holder IS an old role account (their own role is the
// seat's role), taking the seat away leaves that account with nothing to be -
// so we ask what it should become.
function OutgoingChoice({ value, onChange }: { value: OutgoingHolderAction; onChange: (v: OutgoingHolderAction) => void }) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">What happens to the current holder&apos;s account?</p>
      <RadioGroup
        value={value.action === "DEACTIVATE" ? "DEACTIVATE" : value.role}
        onValueChange={(v) => onChange(v === "DEACTIVATE" ? { action: "DEACTIVATE" } : { action: "SET_PRIMARY", role: v as UserRole })}
      >
        <div className="flex items-start gap-2">
          <RadioGroupItem value="DEACTIVATE" id="out-deactivate" />
          <Label htmlFor="out-deactivate" className="font-normal">
            It was only the role&apos;s login - retire it (history stays)
          </Label>
        </div>
        {PRIMARY_ROLE_CHOICES.map((r) => (
          <div key={r} className="flex items-start gap-2">
            <RadioGroupItem value={r} id={`out-${r}`} />
            <Label htmlFor={`out-${r}`} className="font-normal">
              It&apos;s a real person - they carry on as {ROLE_LABELS[r]}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

function needsOutgoing(seat: RoleSeat, people: Person[]): boolean {
  const holder = people.find((p) => p.uid === seat.holderUid);
  return !!holder && roleMatchesSeat(holder.storedRole ?? holder.role, seat.role);
}

function AssignDialog({
  seat, onClose, people, patchSeat, onDone,
}: {
  seat: RoleSeat | null;
  onClose: () => void;
  people: Person[];
  patchSeat: (id: string, body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onDone: () => Promise<void>;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [uid, setUid] = useState("");
  const [note, setNote] = useState("");
  const [outgoing, setOutgoing] = useState<OutgoingHolderAction>({ action: "DEACTIVATE" });
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people
      .filter((p) => p.uid !== seat?.holderUid)
      .filter((p) => !seat || canHoldSeat(p.role, seat.role))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 100);
  }, [people, search, seat]);

  if (!seat) return null;
  const outgoingNeeded = needsOutgoing(seat, people);
  const chosen = people.find((p) => p.uid === uid);

  async function submit() {
    if (!seat || !uid) { toast({ variant: "destructive", title: "Pick a person" }); return; }
    setBusy(true);
    const r = await patchSeat(seat.id, { action: "ASSIGN", uid, note: note.trim() || undefined, ...(outgoingNeeded ? { outgoing } : {}) });
    setBusy(false);
    if (!r.ok) { toast({ variant: "destructive", title: r.error ?? "Failed" }); return; }
    toast({ variant: "success", title: `${seat.label} assigned` });
    setUid(""); setNote(""); setSearch("");
    onClose();
    await onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{seat.holderUid ? "Change" : "Assign"} - {seat.label}</DialogTitle>
          <DialogDescription>
            The person keeps their own login and dashboard; this seat&apos;s modules are added to it.
            {seat.holderUid && ` ${seat.holderName} loses this role's modules straight away - their own profile and history are untouched.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Person</Label>
            {/* `modal` because this picker lives inside a Dialog. A Radix
                Dialog is modal and locks scrolling everywhere outside its own
                content, and PopoverContent portals to <body> - outside it - so
                the wheel over this list was being swallowed and a list longer
                than its max height could not be reached. Marking the Popover
                modal gives it its own scroll lock with the list as the allowed
                area. The two other comboboxes in the app (DocumentTypeCombobox,
                StudentPromotionsPanel) are not inside a Dialog and so are not
                affected. */}
            <Popover modal open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={popoverOpen}
                  className="w-full justify-between font-normal"
                >
                  <span className={cn("truncate", !chosen && "text-muted-foreground")}>
                    {chosen
                      ? `${chosen.name} · ${ROLE_LABELS[chosen.role as UserRole] ?? chosen.role}${chosen.department ? ` · ${chosen.department}` : ""}`
                      : "Search by name or email"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Search by name or email" value={search} onValueChange={setSearch} />
                  <CommandList>
                    <CommandEmpty>No matching person.</CommandEmpty>
                    <CommandGroup>
                      {list.map((p) => (
                        <CommandItem key={p.uid} value={p.uid} onSelect={() => { setUid(p.uid); setPopoverOpen(false); }}>
                          <Check className={cn("mr-2 h-4 w-4", uid === p.uid ? "opacity-100" : "opacity-0")} />
                          {p.name} · {ROLE_LABELS[p.role as UserRole] ?? p.role}{p.department ? ` · ${p.department}` : ""}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          {(() => {
            // An HOD runs a department; the person's own teaching stays in their own
            // department. Heading a different one is allowed but worth a heads-up:
            // HOD screens follow this department, their own teaching / leave / profile
            // keep following their own.
            if (!chosen || seat.role !== "HOD" || !seat.departmentName || !chosen.department || chosen.department === seat.departmentName) return null;
            return (
              <p className="text-xs rounded-md border border-amber-300 bg-amber-50 p-2.5 text-amber-800">
                {chosen.name} belongs to <strong>{chosen.department}</strong>, not {seat.departmentName}. They will run {seat.departmentName} as HOD,
                while their own teaching, leave and profile stay with {chosen.department}.
              </p>
            );
          })()}
          <div className="space-y-2">
            <Label>Note <span className="font-normal text-muted-foreground">(optional, kept in the history)</span></Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {outgoingNeeded && <OutgoingChoice value={outgoing} onChange={setOutgoing} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!uid}>{seat.holderUid ? "Change holder" : "Assign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VacateDialog({
  seat, onClose, people, patchSeat, onDone,
}: {
  seat: RoleSeat | null;
  onClose: () => void;
  people: Person[];
  patchSeat: (id: string, body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onDone: () => Promise<void>;
}) {
  const [outgoing, setOutgoing] = useState<OutgoingHolderAction>({ action: "DEACTIVATE" });
  const [busy, setBusy] = useState(false);
  if (!seat) return null;
  const outgoingNeeded = needsOutgoing(seat, people);

  return (
    <ConfirmDialog
      open onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Vacate ${seat.label}?`}
      description={`${seat.holderName} loses this role's modules straight away. Nothing is deleted - the role keeps its history and the next person to hold it inherits everything.`}
      confirmLabel="Vacate" variant="destructive" loading={busy}
      onConfirm={async () => {
        setBusy(true);
        const r = await patchSeat(seat.id, { action: "VACATE", ...(outgoingNeeded ? { outgoing } : {}) });
        setBusy(false);
        if (!r.ok) { toast({ variant: "destructive", title: r.error ?? "Failed" }); return; }
        toast({ variant: "success", title: "Role vacated" });
        onClose();
        await onDone();
      }}
    >
      {outgoingNeeded && <OutgoingChoice value={outgoing} onChange={setOutgoing} />}
    </ConfirmDialog>
  );
}

function HistoryDialog({ seat, onClose, qs }: { seat: RoleSeat | null; onClose: () => void; qs: string }) {
  const [history, setHistory] = useState<RoleSeatHistoryEntry[] | null>(null);
  const seatId = seat?.id;

  useEffect(() => {
    if (!seatId) return;
    let cancelled = false;
    void (async () => { setHistory(null); })();
    fetch(`/api/college/role-seats/${seatId}${qs}`)
      .then((r) => r.json() as Promise<{ history?: RoleSeatHistoryEntry[] }>)
      .then((d) => { if (!cancelled) setHistory(d.history ?? []); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [seatId, qs]);

  if (!seat) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>History - {seat.label}</DialogTitle>
          <DialogDescription>Everyone who has held this role, most recent first.</DialogDescription>
        </DialogHeader>
        {history === null ? (
          <div className="h-16 bg-muted animate-pulse rounded-lg" />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one has held this role yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border max-h-80 overflow-y-auto">
            {history.map((h) => (
              <li key={h.id} className="p-3 space-y-0.5">
                <p className="text-sm font-medium">{h.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(h.from)} - {h.to ? formatDate(h.to) : "present"} · appointed by {h.assignedByName}
                </p>
                {h.note && <p className="text-xs">{h.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RoleEmailDialog({
  seat, onClose, patchSeat, onDone,
}: {
  seat: RoleSeat | null;
  onClose: () => void;
  patchSeat: (id: string, body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onDone: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const seatId = seat?.id;
  useEffect(() => {
    void (async () => { setValue(seat?.roleEmail ?? ""); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatId]);
  if (!seat) return null;

  async function save() {
    if (!seat) return;
    setBusy(true);
    const r = await patchSeat(seat.id, { action: "UPDATE", roleEmail: value.trim() || null });
    setBusy(false);
    if (!r.ok) { toast({ variant: "destructive", title: r.error ?? "Failed" }); return; }
    toast({ variant: "success", title: "Role email saved" });
    onClose();
    await onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Role email - {seat.label}</DialogTitle>
          <DialogDescription>
            The position&apos;s own contact address. It stays with the seat as people change and is not a login - everyone signs in with their personal college email.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Role email</Label>
          <Input type="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. hod.cse@yourcollege.edu" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddSeatDialog({
  open, onOpenChange, qs, departments, seats, canCreate, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  qs: string;
  departments: Dept[];
  seats: RoleSeat[];
  canCreate: () => boolean;
  onDone: () => Promise<void>;
}) {
  const [role, setRole] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  // Only roles you're allowed to appoint, and - for one-per-college roles - not
  // ones that already have their seat. College Admin is excluded outright: an
  // empty seat here can only be filled by ASSIGNing an existing login, but the
  // College Admin is usually the very first person in a brand-new college -
  // there's no one yet to pick from. That's why it's created together with its
  // seat, in one step, from Administration's "Add College Admin" page instead
  // (see api/administration/college-people) - this dialog would otherwise let
  // someone create an unfillable vacant seat.
  const roleOptions = SEAT_ROLES.filter((r) => r !== "COLLEGE_ADMIN" && canCreate() && (!isSingletonSeatRole(r) || !seats.some((s) => s.role === r)));
  const freeDepartments = departments.filter((d) => !seats.some((s) => s.role === role && s.departmentId === d.id));

  async function submit() {
    if (!role) { toast({ variant: "destructive", title: "Pick a role" }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/college/role-seats${qs}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          departmentId: seatNeedsDepartment(role) ? departmentId : undefined,
          label: label.trim() || undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast({ variant: "success", title: "Role added" });
      setRole(""); setDepartmentId(""); setLabel("");
      onOpenChange(false);
      await onDone();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Role</DialogTitle>
          <DialogDescription>Create the position first, then appoint a person to it. The role email is entered once here and stays with the role.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {role && seatNeedsDepartment(role) && (
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="Select a department" /></SelectTrigger>
                <SelectContent>
                  {freeDepartments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {freeDepartments.length === 0 && <p className="text-xs text-muted-foreground">Every department already has a {ROLE_LABELS[role as UserRole]} seat.</p>}
            </div>
          )}
          {role && !seatNeedsDepartment(role) && !isSingletonSeatRole(role) && (
            <div className="space-y-2">
              <Label>Name of the role</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`e.g. ${ROLE_LABELS[role as UserRole]} (Academics)`} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!role}>Add Role</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
