"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { Book } from "@/types";

type BookRow = Book & Record<string, unknown>;

const EMPTY_FORM = { title: "", author: "", isbn: "", category: "", publisher: "", totalCopies: "1" };

// Open Library's public lookup - client-side convenience autofill only (not
// authoritative), so no server route is needed: the librarian still reviews
// every field before saving.
async function lookupIsbn(isbn: string): Promise<{ title?: string; author?: string; publisher?: string } | null> {
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { title?: string; authors?: { name: string }[]; publishers?: { name: string }[] }>;
    const entry = data[`ISBN:${isbn}`];
    if (!entry) return null;
    return {
      title: entry.title,
      author: entry.authors?.map((a) => a.name).join(", "),
      publisher: entry.publishers?.map((p) => p.name).join(", "),
    };
  } catch {
    return null;
  }
}

export default function LibraryBooksPage() {
  const [books, setBooks] = useState<BookRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);

  async function loadBooks() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/library/books");
      const json = (await res.json()) as { books?: Book[] };
      setBooks((json.books ?? []) as BookRow[]);
    } catch {
      toast({ variant: "destructive", title: "Failed to load books" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadBooks();
  }, []);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(b: Book) {
    setEditing(b);
    setForm({
      title: b.title,
      author: b.author,
      isbn: b.isbn ?? "",
      category: b.category ?? "",
      publisher: b.publisher ?? "",
      totalCopies: String(b.totalCopies),
    });
    setDialogOpen(true);
  }

  async function handleIsbnBlur() {
    const isbn = form.isbn.trim();
    if (!isbn || form.title.trim()) return; // don't overwrite a title already typed
    const result = await lookupIsbn(isbn);
    if (result) {
      setForm((f) => ({
        ...f,
        title: result.title || f.title,
        author: result.author || f.author,
        publisher: result.publisher || f.publisher,
      }));
    }
  }

  async function handleSave() {
    if (!form.title.trim() || !form.author.trim()) {
      toast({ variant: "destructive", title: "Title and Author are required" });
      return;
    }
    setIsSaving(true);
    try {
      const url = editing ? `/api/college/library/books/${editing.id}` : "/api/college/library/books";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          author: form.author.trim(),
          isbn: form.isbn.trim(),
          category: form.category.trim(),
          publisher: form.publisher.trim(),
          totalCopies: Number(form.totalCopies),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to save book" });
        return;
      }
      toast({ variant: "success", title: editing ? "Book updated" : "Book added" });
      setDialogOpen(false);
      void loadBooks();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/college/library/books/${deleteTarget.id}`, { method: "DELETE" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to delete book" });
        return;
      }
      toast({ variant: "success", title: "Book removed" });
      setDeleteTarget(null);
      void loadBooks();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    }
  }

  const columns: Column<BookRow>[] = [
    { key: "title", header: "Title", render: (b) => <span className="font-medium">{b.title}</span> },
    { key: "author", header: "Author" },
    { key: "isbn", header: "ISBN", hideOnMobile: true, render: (b) => b.isbn || <span className="text-muted-foreground/50">—</span> },
    { key: "category", header: "Category", hideOnMobile: true, render: (b) => b.category || <span className="text-muted-foreground/50">—</span> },
    {
      key: "availableCopies",
      header: "Copies",
      render: (b) => (
        <Badge variant={b.availableCopies > 0 ? "secondary" : "destructive"}>
          {b.availableCopies} / {b.totalCopies}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromCsv: true,
      render: (b) => (
        <div className="flex items-center gap-1 justify-end">
          <button onClick={() => openEdit(b)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit book">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={() => setDeleteTarget(b)} className="p-1.5 rounded-md hover:bg-red-100 text-red-600" title="Remove book">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Book Catalog"
        description="Manage the library's books and copy counts"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/library/books/import">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Link>
            </Button>
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Book
            </Button>
          </div>
        }
      />

      <DataTable
        data={books}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by title, author or ISBN"
        searchKeys={["title", "author", "isbn"]}
        keyExtractor={(b) => b.id}
        emptyTitle="No books yet"
        emptyDescription="Add your first book to the catalog."
        csvFilename="library-books"
        paginate
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Book" : "Add Book"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="isbn">ISBN</Label>
              <Input id="isbn" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} onBlur={handleIsbnBlur} placeholder="Optional - autofills title/author" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="author">Author</Label>
              <Input id="author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="category">Category</Label>
                <Input id="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="publisher">Publisher</Label>
                <Input id="publisher" value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="totalCopies">Total Copies</Label>
              <Input id="totalCopies" type="number" min={1} value={form.totalCopies} onChange={(e) => setForm({ ...form, totalCopies: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={isSaving}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this book?"
        description={`"${deleteTarget?.title}" will be permanently removed from the catalog.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
