"use client";

import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResumeSectionsDialog } from "@/components/faculty/ResumeSectionsDialog";
import { downloadResumePdf } from "@/lib/pdf/downloadResume";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import type { ResumeSectionKey } from "@/lib/pdf/resumeSections";
import type { FacultyMember } from "@/types";

// "Download Resume" for the signed-in person's own My Profile page, with the
// same section picker the HOD gets on the faculty register.
//
// Self-contained on purpose: it resolves the caller's own record and RENDERS
// NOTHING when there isn't one. Several profile pages belong to roles with no
// faculty record at all (Management, Administration, Super Admin), so a
// button that always drew itself would be a dead control on those pages.
export function MyResumeDownloadButton() {
  const { user } = useAuth();
  const [faculty, setFaculty] = useState<Partial<FacultyMember> | null>(null);
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/college/faculty/me");
        const data = await res.json() as { faculty?: Partial<FacultyMember> | null };
        if (!cancelled) setFaculty(data.faculty ?? null);
      } catch {
        // Non-fatal - the button simply doesn't appear.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleDownload(sections: ResumeSectionKey[]) {
    if (!faculty) return;
    setDownloading(true);
    try {
      // Same two enrichments the HOD's download makes, so a self-downloaded
      // resume matches the one an HOD would produce for the same person.
      let teachingAssignments: unknown[] = [];
      if (faculty.id) {
        try {
          const r = await fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(faculty.id)}`);
          teachingAssignments = ((await r.json()) as { assignments?: unknown[] }).assignments ?? [];
        } catch { /* non-critical - resume still generates without the live teaching-load table */ }
      }
      let researchPublications: unknown[] = [];
      const researchUid = faculty.userUid ?? user?.uid;
      if (researchUid) {
        try {
          const r = await fetch(`/api/college/publications?uid=${encodeURIComponent(researchUid)}`);
          researchPublications = ((await r.json()) as { publications?: unknown[] }).publications ?? [];
        } catch { /* non-critical - resume falls back to self-reported publications, if any */ }
      }
      await downloadResumePdf(
        { ...faculty, teachingAssignments, researchPublications, sections },
        faculty.employeeId || facultyDisplayName(faculty) || "resume"
      );
      setOpen(false);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to generate resume" });
    } finally {
      setDownloading(false);
    }
  }

  if (!faculty) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileDown className="h-4 w-4 mr-2" />
        Download Resume
      </Button>
      {open && (
        <ResumeSectionsDialog
          open
          onOpenChange={setOpen}
          personName={facultyDisplayName(faculty) || "you"}
          downloading={downloading}
          onDownload={handleDownload}
        />
      )}
    </>
  );
}
