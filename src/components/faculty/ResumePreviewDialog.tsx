"use client";

import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Props {
  /** Whose resume - shown in the title. */
  personName: string;
  /** Builds the resume as HTML (`previewFacultyResumeHtml`). */
  loadHtml: () => Promise<string>;
  onOpenChange: (open: boolean) => void;
  /** Moves on to the Download Resume dialog (section picker) for the same person. */
  onDownload: () => void;
}

// On-screen preview of the resume before it is downloaded. Mount it only while a preview is wanted;
// it fetches once on mount. The HTML is the same document the PDF is rendered from.
export function ResumePreviewDialog({ personName, loadHtml, onOpenChange, onDownload }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const doc = await loadHtml();
        if (!cancelled) setHtml(doc);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the preview");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Resume Preview - {personName}</DialogTitle>
        </DialogHeader>

        <div className="h-[70vh] overflow-hidden rounded-md border bg-muted/30">
          {error ? (
            <p className="p-6 text-sm text-destructive">{error}</p>
          ) : html === null ? (
            <p className="p-6 text-sm text-muted-foreground animate-pulse">Preparing preview...</p>
          ) : (
            // No scripts or same-origin access: the document is only ever shown, never run.
            <iframe title={`Resume of ${personName}`} srcDoc={html} sandbox="" className="h-full w-full bg-white" />
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" disabled={html === null} onClick={onDownload}>
            <FileDown className="h-4 w-4 mr-2" />
            Download Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
