"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { HIGHEST_QUALIFICATION_OPTIONS } from "@/lib/import/fieldConstraints";
import { PHONE_REGEX } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import type { FacultyMember } from "@/types";

// Sentinel for the "Others" row - matches hod/faculty/new/page.tsx's own
// qualification picker so a faculty member sees the same Select behavior
// editing their own record as an HOD sees creating one.
const OTHER_QUALIFICATION = "__OTHER__";

type EditableFields = Pick<FacultyMember, "legalName" | "name" | "apaarFacultyId" | "qualification" | "specialization" | "email" | "phone"> & {
  additionalPhoneNumbers?: { label?: string; number: string }[];
};

interface Props {
  faculty: Partial<FacultyMember>;
  // Called with just the fields this dialog can change, merged onto the
  // caller's own faculty state - the server is the source of truth for
  // everything else (Employee ID, Designation, Department, ...).
  onSaved: (updates: Partial<FacultyMember>) => void;
}

// Self-service edit for the subset of "Identity & Employment" fields a
// Faculty member is allowed to change about themselves. Deliberately excludes
// Employee ID, College Email, Login Password, Designation, Date of Joining,
// AICTE Eligible/AICTE Faculty ID (HR/HOD-controlled, unchanged since account
// creation) and Department/Employee Category (drive HOD department-scope and
// payroll auto-pricing respectively - changing either here would silently
// break section/HOD-scope links or salary structure pricing, so those stay
// editable only by HOD/Principal/VP via PATCH /api/college/faculty/[id]).
export function EditFacultyIdentityDialog({ faculty, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [legalName, setLegalName] = useState(faculty.legalName ?? "");
  const [name, setName] = useState(faculty.name ?? "");
  const [apaarFacultyId, setApaarFacultyId] = useState(faculty.apaarFacultyId ?? "");
  const isKnownQualification = (HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(faculty.qualification ?? "");
  const [qualIsOther, setQualIsOther] = useState(!!faculty.qualification && !isKnownQualification);
  const [qualification, setQualification] = useState(faculty.qualification ?? "");
  const [specialization, setSpecialization] = useState(faculty.specialization ?? "");
  const [email, setEmail] = useState(faculty.email ?? "");
  const [phone, setPhone] = useState(faculty.phone ?? "");
  const [extraPhones, setExtraPhones] = useState<{ label?: string; number: string }[]>(faculty.additionalPhoneNumbers ?? []);
  const [error, setError] = useState<string | null>(null);

  function resetToFaculty() {
    setLegalName(faculty.legalName ?? "");
    setName(faculty.name ?? "");
    setApaarFacultyId(faculty.apaarFacultyId ?? "");
    setQualIsOther(!!faculty.qualification && !(HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(faculty.qualification));
    setQualification(faculty.qualification ?? "");
    setSpecialization(faculty.specialization ?? "");
    setEmail(faculty.email ?? "");
    setPhone(faculty.phone ?? "");
    setExtraPhones(faculty.additionalPhoneNumbers ?? []);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.stopPropagation();
    e.preventDefault();
    setError(null);

    if (!legalName.trim()) {
      setError("Full Name (as per SSC) is required");
      return;
    }
    if (!qualification.trim()) {
      setError("Highest Qualification is required");
      return;
    }
    if (!phone.trim() || !PHONE_REGEX.test(phone)) {
      setError("Mobile No is required and must be a valid phone number");
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Invalid email address");
      return;
    }

    const updates: EditableFields = {
      legalName: legalName.trim().toUpperCase(),
      name: name.trim(),
      apaarFacultyId: apaarFacultyId.trim(),
      qualification: qualification.trim(),
      specialization: specialization.trim(),
      email: email.trim(),
      phone: phone.trim(),
      additionalPhoneNumbers: extraPhones.filter((p) => p.number.trim()),
    };

    setSaving(true);
    try {
      const res = await fetch("/api/college/faculty/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save changes");
      }
      onSaved(updates);
      toast({ variant: "success", title: "Profile updated" });
      setOpen(false);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save changes" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetToFaculty(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Pencil className="h-4 w-4 mr-2" />Edit Details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Identity & Employment Details</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <p className="text-xs text-muted-foreground -mt-2">
            Employee ID, College Email, Designation, Department, Date of Joining and AICTE Eligibility/AICTE Faculty ID are set by your HOD/Principal and can&apos;t be changed here.
          </p>

          <div className="space-y-2">
            <Label htmlFor="edit-legalName">Full Name (as per SSC) *</Label>
            <Input
              id="edit-legalName"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value.toUpperCase())}
              placeholder="FULL NAME IN CAPITALS"
              className="uppercase"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-name">Name (as per PAN)</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Priya Nair" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-apaar">APAAR Faculty ID</Label>
            <Input id="edit-apaar" value={apaarFacultyId} onChange={(e) => setApaarFacultyId(e.target.value)} placeholder="NBA/AICTE APAAR ID" />
          </div>

          <div className="space-y-2">
            <Label>Highest Qualification *</Label>
            <Select
              value={qualIsOther ? OTHER_QUALIFICATION : qualification}
              onValueChange={(v) => {
                const other = v === OTHER_QUALIFICATION;
                setQualIsOther(other);
                setQualification(other ? "" : v);
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger>
              <SelectContent>
                {HIGHEST_QUALIFICATION_OPTIONS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                <SelectItem value={OTHER_QUALIFICATION}>Others</SelectItem>
              </SelectContent>
            </Select>
            {qualIsOther && (
              <Input value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. MBA, M.Phil, M.A" />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-specialization">Specialization</Label>
            <Input id="edit-specialization" value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="e.g. Machine Learning, VLSI" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-email">Personal Email</Label>
            <Input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="faculty@example.com" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-phone">Mobile No *</Label>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setExtraPhones((p) => [...p, { label: "", number: "" }])}
              >
                + Add Number
              </Button>
            </div>
            <Input id="edit-phone" type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </div>

          {extraPhones.length > 0 && (
            <div className="space-y-3">
              {extraPhones.map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <TextInput
                      label="Label (optional)"
                      value={item.label}
                      onChange={(v) => setExtraPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, label: v } : p)))}
                      placeholder="e.g. Personal, WhatsApp, or a name"
                    />
                    <TextInput
                      label="Mobile Number"
                      value={item.number}
                      onChange={(v) => setExtraPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, number: v } : p)))}
                      placeholder="+91 98765 43210"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-7"
                    onClick={() => setExtraPhones((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
