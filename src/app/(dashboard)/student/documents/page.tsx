"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import type { StudentDocument } from "@/types";

// Student's own documents - the office-uploaded certificates list, shown
// abstracted (title + description), click to download the file.
export default function StudentDocumentsPage() {
  const [documents, setDocuments] = useState<StudentDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/student/me/documents")
      .then(async (r) => {
        const body = (await r.json()) as { documents?: StudentDocument[]; error?: string };
        if (!r.ok) throw new Error(body.error ?? "Failed to load documents");
        setDocuments(body.documents ?? []);
      })
      .catch((err: unknown) => toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load documents" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="My Documents" description="Certificates and documents your College Office has on file for you" />
        <Button asChild variant="outline" size="sm">
          <Link href="/student">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Dashboard
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="h-48 rounded-xl border bg-muted/30 animate-pulse" />
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/10">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="font-medium text-foreground">No documents yet</p>
          <p className="mt-1 text-xs">Documents your College Office uploads for you will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {documents.map((d) => (
            <a key={d.id} href={d.fileUrl} target="_blank" rel="noopener noreferrer">
              <Card className="hover:bg-muted/20 transition-colors cursor-pointer h-full">
                <CardContent className="p-4 space-y-2">
                  <p className="font-medium text-sm text-foreground line-clamp-2">{d.title}</p>
                  {d.description && <p className="text-xs text-muted-foreground line-clamp-2">{d.description}</p>}
                  <div className="flex items-center gap-1.5 pt-2 border-t border-border/60 text-xs text-primary font-medium">
                    <Download className="h-3.5 w-3.5" /> Download
                  </div>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
