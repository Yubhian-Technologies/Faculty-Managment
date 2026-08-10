"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { ResearchPublication } from "@/types";

type PublicationRow = ResearchPublication & Record<string, unknown>;

export default function RAndDPublicationsPage() {
  const router = useRouter();
  const [publications, setPublications] = useState<PublicationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PublicationRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/publications");
      const data = await res.json() as { publications: PublicationRow[] };
      setPublications(data.publications ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load publications" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleDelete(pub: PublicationRow) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/college/publications/${pub.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Publication deleted" });
      setDeleteTarget(null);
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete publication" });
    } finally {
      setDeleting(false);
    }
  }

  const columns: Column<PublicationRow>[] = [
    {
      key: "ownerName",
      header: "Owner",
      render: (row) => (
        <div>
          <p className="font-medium">{row.ownerName}</p>
          <Badge variant="outline" className="text-xs font-normal">{ROLE_LABELS[row.ownerRole] ?? row.ownerRole}</Badge>
        </div>
      ),
    },
    { key: "title", header: "Title" },
    { key: "journalOrConference", header: "Journal / Conference", hideOnMobile: true },
    { key: "publicationYear", header: "Year" },
    {
      key: "indexing",
      header: "Indexing",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{row.indexing || "-"}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/r-and-d/publications/${row.id}/edit`); }}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Research Publications"
        description="Manage the official publication record for every staff member"
        actions={
          <Button onClick={() => router.push("/r-and-d/publications/new")}>
            <Plus className="h-4 w-4 mr-2" />Add Publication
          </Button>
        }
      />

      <DataTable
        data={publications}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search publications..."
        searchKeys={["title", "ownerName", "journalOrConference"] as (keyof PublicationRow)[]}
        emptyTitle="No publications yet"
        emptyDescription="Add the first publication record"
        emptyAction={
          <Button onClick={() => router.push("/r-and-d/publications/new")}>
            <FlaskConical className="h-4 w-4 mr-2" />Add Publication
          </Button>
        }
        csvFilename="research-publications"
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Publication?"
        description={`This will permanently remove "${deleteTarget?.title}" from ${deleteTarget?.ownerName}'s record.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={() => { if (deleteTarget) void handleDelete(deleteTarget); }}
      />
    </div>
  );
}
