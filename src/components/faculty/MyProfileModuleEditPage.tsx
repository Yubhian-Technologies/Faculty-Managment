"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/authStore";
import { getUserById } from "@/lib/firestore/users";
import { FacultyProfileModuleEditor, type FacultyEditRecord } from "@/components/faculty/FacultyProfileModuleEditor";
import { getMissingRequiredPersonalFields, STAFF_REQUIRED_PERSONAL_FIELDS, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { PROFILE_MODULES, SELF_EDIT_DISABLED_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import { migrateFacultyDoc } from "@/lib/faculty/fieldRenames";
import { personalRecordFromDoc, personalPatchBody } from "@/lib/faculty/personalRecord";
import { diffAcademicProfile, isEmptyChanges } from "@/lib/faculty/academicProfileChanges";
import { degreeTypeError } from "@/lib/faculty/degreeType";

interface Props {
  basePath: string;       // e.g. "/hod/profile"
  patchEndpoint: string;  // "/api/college/users/me" | "/api/college/faculty/me"
  // True only for callers whose patchEndpoint understands `academicProfileChanges`
  // (PATCH /api/college/faculty/me): a tab's save then sends just the academicProfile
  // keys it changed instead of the whole object, so it can't overwrite another tab
  // (or the HOD's own save) with the copy loaded here. Every other endpoint still
  // takes the whole academicProfile, so this stays off for them.
  sectionScopedProfileSave?: boolean;
  // This page is reused by many roles beyond Faculty (Webmaster, IQAC
  // Coordinator, College Staff, etc. - see each role's profile/[module]/edit
  // page.tsx) - defaults to the full Staff-shaped requirement (every
  // existing caller's current behavior); only a genuinely Faculty-shaped
  // caller (Panel, whose patchEndpoint is /api/college/faculty/me) opts into
  // FACULTY_REQUIRED_PERSONAL_FIELDS instead.
  requiredPersonalFields?: (keyof PersonalDetailsValue)[];
  // Full Name (as per SSC) lives only under Identity & Employment, right after
  // Employee ID - Panel (the only caller with its own dedicated Identity &
  // Employment editor, at panel/profile/edit) passes this so it isn't shown a
  // second time on this Personal Details tab. Every other role sharing this
  // page has no such separate page, so this tab stays their only place to set
  // it - default false preserves that.
  hideLegalName?: boolean;
}

// Shared self-profile per-module edit page for HOD and Panel (both source
// current values from GET /api/college/faculty/me, which falls back to the
// thin users/{uid} doc for roles with no FacultyMember record - see that
// route's comments). Principal/VP have their own edit page since their View
// side already bypasses this endpoint entirely (see principal/profile).
export function MyProfileModuleEditPage({ basePath, patchEndpoint, sectionScopedProfileSave = false, requiredPersonalFields = STAFF_REQUIRED_PERSONAL_FIELDS, hideLegalName = false }: Props) {
  const router = useRouter();
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);
  const { collegeType } = useCollegeType();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<FacultyEditRecord>({});
  // The academicProfile as loaded - see sectionScopedProfileSave.
  const [originalAcademicProfile, setOriginalAcademicProfile] = useState<FacultyEditRecord["academicProfile"]>({});
  // The id of the record actually being edited: the facultyMembers doc id for a Faculty
  // login (NOT the login uid), the login's own users doc id (= its uid) for roles that
  // have no separate faculty record. Needed wherever the editor keys something to "this
  // person" - e.g. Professional Development's "(You)" / exclude-myself co-conductor logic.
  const [recordId, setRecordId] = useState("");
  // Set when the server says this login has no faculty record to edit.
  const [unlinkedMessage, setUnlinkedMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/college/faculty/me")
      .then((r) => r.json() as Promise<{ faculty?: Record<string, unknown> | null; message?: string }>)
      .then((d) => {
        if (!d.faculty) {
          setUnlinkedMessage(d.message ?? "No profile record was found for your login.");
          return;
        }
        const m = migrateFacultyDoc(d.faculty as Record<string, unknown>);
        const academicProfile = (m.academicProfile as FacultyEditRecord["academicProfile"]) ?? {};
        setRecordId(typeof d.faculty.id === "string" ? d.faculty.id : "");
        setOriginalAcademicProfile(academicProfile);
        setRecord({ ...personalRecordFromDoc(m), academicProfile });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load profile" }))
      .finally(() => setLoading(false));
  }, []);

  function patch(next: Partial<FacultyEditRecord>) {
    setRecord((r) => ({ ...r, ...next }));
  }

  async function handleSave() {
    if (moduleKey === "personal") {
      const missing = getMissingRequiredPersonalFields(record, requiredPersonalFields);
      if (missing.length > 0) {
        toast({ variant: "destructive", title: "Some required fields are missing", description: missing.join(", ") });
        return;
      }
    }
    if (moduleKey === "qualification") {
      const degreeErr = degreeTypeError(record.academicProfile);
      if (degreeErr) {
        toast({ variant: "destructive", title: "Some required fields are missing", description: degreeErr });
        return;
      }
    }
    setSaving(true);
    try {
      let body: Record<string, unknown>;
      if (moduleKey === "personal") {
        body = personalPatchBody(record);
      } else if (sectionScopedProfileSave) {
        const academicProfileChanges = diffAcademicProfile(originalAcademicProfile, record.academicProfile);
        if (isEmptyChanges(academicProfileChanges)) {
          toast({ variant: "success", title: "No changes to save" });
          router.push(`${basePath}/${moduleKey}`);
          return;
        }
        body = { academicProfileChanges };
      } else {
        body = { academicProfile: record.academicProfile };
      }

      const res = await fetch(patchEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error);
      }

      toast({ variant: "success", title: "Saved" });

      if (user) {
        try {
          const freshProfile = await getUserById(user.collegeId, user.uid);
          if (freshProfile) setUser(freshProfile);
        } catch {
          // non-fatal - profile was saved; TopBar catches up on next load
        }
      }
      router.push(`${basePath}/${moduleKey}`);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error && err.message ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  if (SELF_EDIT_DISABLED_MODULES.includes(moduleKey)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`Edit ${moduleDef.label}`}
          actions={
            <Button variant="outline" asChild>
              <Link href={`${basePath}/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
          }
        />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">This section isn&apos;t self-editable.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${moduleDef.label}`}
        actions={
          <Button variant="outline" asChild>
            <Link href={`${basePath}/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : unlinkedMessage ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">{unlinkedMessage}</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <FacultyProfileModuleEditor
              moduleKey={moduleKey}
              record={record}
              onChange={patch}
              facultyId={recordId}
              includeTeachingAssignment={false}
              collegeType={collegeType}
              requiredPersonalFields={requiredPersonalFields}
              hideLegalName={hideLegalName}
            />
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => router.push(`${basePath}/${moduleKey}`)}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
