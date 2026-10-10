"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { FieldInput } from "@/components/students/RosterFieldInputs";
import { StudentOwnDocuments } from "@/components/students/StudentOwnDocuments";
import { ROSTER_FIELDS } from "@/lib/students/rosterFields";
import { STUDENT_SELF_EDIT_GROUPS } from "@/lib/students/selfEdit";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/useToast";

interface Row {
  label: string;
  value: string;
}

interface ProfileResponse {
  header: { name: string; rollNumber: string; photoUrl: string; status: string };
  identity: Row[];
  groups: { title: string; rows: Row[] }[];
  editable?: { values: Record<string, string>; mobileEditable: boolean; mobileLockedReason: string };
  error?: string;
}

const FIELD_BY_KEY = new Map(ROSTER_FIELDS.map((f) => [f.key, f]));

// The supporting-document uploads (shown only when "Studied Outside AP" / "Family ID Linked to Another State" is Yes)
// sit at the bottom of this group, in view and in edit mode.
const DOCUMENTS_GROUP_TITLE = "Additional Information";

function Fields({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{r.label}</dt>
          <dd className="break-words text-sm font-medium">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// "My Profile" - everything the college holds about the logged-in student, on one page (reached from the avatar in the
// top bar). The student can edit their own contact, family, address and bank details and their photo; identity and
// academic data (Roll No, name, course, department, year, section, admission details...) stays with the College
// Office. The server sends ready-made rows with staff-only fields removed, and refuses any non-editable field.
export default function StudentProfilePage() {
  const { user } = useAuth();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  // The values as loaded - a save sends ONLY what the student changed, so it can never overwrite something the Office
  // changed in the meantime.
  const [original, setOriginal] = useState<Record<string, string>>({});
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/college/student/me/profile", { cache: "no-store" });
      const body = (await r.json()) as ProfileResponse;
      if (!r.ok) throw new Error(body.error ?? "Failed to load your profile");
      setData(body);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load your profile");
    } finally {
      setIsLoading(false);
      loaded.current = true;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The photo changed (uploaded / removed through the avatar) - show what is stored now.
  const storePhoto = user?.profilePhotoUrl;
  useEffect(() => {
    if (loaded.current) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storePhoto]);

  function startEdit() {
    if (!data?.editable) return;
    setValues({ ...data.editable.values });
    setOriginal({ ...data.editable.values });
    setEditing(true);
  }

  async function save() {
    if (!data?.editable) return;
    const changed: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(values)) {
      if ((v ?? "").trim() !== (original[k] ?? "").trim()) changed[k] = v.trim() ? v.trim() : null;
    }
    if (Object.keys(changed).length === 0) {
      toast({ variant: "success", title: "No changes to save" });
      setEditing(false);
      return;
    }
    if ("mobileNo" in changed && changed.mobileNo === null) {
      toast({ variant: "destructive", title: "Student Mobile No can't be removed - enter the correct number instead" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/college/student/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ details: changed }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to save");
      toast({ variant: "success", title: "Your details were updated" });
      setEditing(false);
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  const setField = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="My Profile"
        description={editing
          ? "Update your contact, family, address and bank details. Roll No, name, course, year and admission details are managed by the College Office."
          : "The details your college holds for you. You can update your own contact details and photo; to correct anything else, contact the College Office."}
        actions={
          <div className="flex gap-2">
            {data?.editable && !editing && (
              <Button onClick={startEdit}><Pencil className="mr-2 h-4 w-4" />Edit Details</Button>
            )}
            <ChangePasswordDialog />
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error || !data ? (
        <div className="rounded-2xl border border-dashed bg-muted/10 p-8 text-center text-sm text-muted-foreground">{error}</div>
      ) : (
        <>
          <Card className="rounded-2xl border-border/60 bg-card/90 shadow-xs">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="flex items-center gap-4">
                <ProfilePhotoUpload
                  name={data.header.name}
                  photoUrl={data.header.photoUrl || undefined}
                  endpoint="/api/college/student/me/photo"
                />
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold leading-tight">{data.header.name}</h2>
                  <p className="text-sm text-muted-foreground">{data.header.rollNumber}</p>
                  <p className="text-xs text-muted-foreground">{data.header.status}</p>
                </div>
              </div>
              <Fields rows={data.identity} />
            </CardContent>
          </Card>

          {editing && data.editable ? (
            <>
              {STUDENT_SELF_EDIT_GROUPS.map((g) => (
                <Card key={g.title} className="rounded-2xl border-border/60 bg-card/90 shadow-xs">
                  <CardContent className="space-y-3 p-4 sm:p-5">
                    <h3 className="text-sm font-semibold">{g.title}</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {g.keys.map((key) => {
                        const field = FIELD_BY_KEY.get(key);
                        if (!field) return null;
                        if (key === "mobileNo" && !data.editable?.mobileEditable) {
                          return (
                            <div key={key} className="space-y-2">
                              <Label>{field.label}</Label>
                              <Input value={values[key] ?? ""} disabled readOnly />
                              <p className="text-xs text-muted-foreground">{data.editable?.mobileLockedReason}</p>
                            </div>
                          );
                        }
                        return (
                          <FieldInput
                            key={key}
                            field={key === "mobileNo" ? { ...field, required: true } : field}
                            values={values}
                            onChange={setField}
                            departments={[]}
                            courseNames={[]}
                            courses={[]}
                            years={[]}
                          />
                        );
                      })}
                    </div>
                    {g.title === DOCUMENTS_GROUP_TITLE && <StudentOwnDocuments answers={values} />}
                  </CardContent>
                </Card>
              ))}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                <Button onClick={() => void save()} loading={saving}>Save Changes</Button>
              </div>
            </>
          ) : (
            data.groups.map((g) => (
              <Card key={g.title} className="rounded-2xl border-border/60 bg-card/90 shadow-xs">
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <h3 className="text-sm font-semibold">{g.title}</h3>
                  <Fields rows={g.rows} />
                  {g.title === DOCUMENTS_GROUP_TITLE && <StudentOwnDocuments answers={data.editable?.values ?? {}} />}
                </CardContent>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}
