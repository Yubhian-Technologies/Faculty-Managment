"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { Book, BookReservation, StudentRecord } from "@/types";

type ReservationRow = BookReservation & Record<string, unknown>;

const STATUS_LABELS: Record<BookReservation["status"], string> = {
  WAITING: "Waiting",
  NOTIFIED: "Notified",
  CANCELLED: "Cancelled",
  FULFILLED: "Fulfilled",
};

export default function LibraryReservationsPage() {
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [students, setStudents] = useState<(StudentRecord & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedBookId, setSelectedBookId] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function loadAll() {
    setIsLoading(true);
    try {
      const [reservationsRes, booksRes, studentsRes] = await Promise.all([
        fetch("/api/college/library/reservations"),
        fetch("/api/college/library/books"),
        fetch("/api/college/students"),
      ]);
      const reservationsJson = (await reservationsRes.json()) as { reservations?: BookReservation[] };
      const booksJson = (await booksRes.json()) as { books?: Book[] };
      const studentsJson = (await studentsRes.json()) as { students?: (StudentRecord & { id: string })[] };
      setReservations((reservationsJson.reservations ?? []) as ReservationRow[]);
      setBooks(booksJson.books ?? []);
      setStudents(studentsJson.students ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load reservations" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const unavailableBooks = useMemo(() => books.filter((b) => b.availableCopies === 0), [books]);

  async function handleJoinQueue() {
    if (!selectedStudentId || !selectedBookId) {
      toast({ variant: "destructive", title: "Select a student and a book" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/library/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudentId, bookId: selectedBookId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to join queue" });
        return;
      }
      toast({ variant: "success", title: "Added to reservation queue" });
      setDialogOpen(false);
      setSelectedStudentId("");
      setSelectedBookId("");
      void loadAll();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsSaving(false);
    }
  }

  const columns: Column<ReservationRow>[] = [
    { key: "bookTitle", header: "Book", render: (r) => <span className="font-medium">{r.bookTitle}</span> },
    { key: "studentName", header: "Student" },
    {
      key: "queuedAt",
      header: "Queued",
      hideOnMobile: true,
      render: (r) => {
        const t = r.queuedAt as unknown as { toDate?: () => Date };
        return typeof t?.toDate === "function" ? t.toDate().toDateString() : "";
      },
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge variant={r.status === "WAITING" ? "secondary" : r.status === "NOTIFIED" ? "default" : "outline"}>{STATUS_LABELS[r.status]}</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservation Queue"
        description="Students waiting for a book with no copies currently available"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add to Queue
          </Button>
        }
      />

      <DataTable
        data={reservations}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by book or student"
        searchKeys={["bookTitle", "studentName"]}
        keyExtractor={(r) => r.id}
        emptyTitle="No reservations"
        emptyDescription="When a book has no copies available, students can be queued here."
        paginate
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Reservation Queue</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Student</Label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                <SelectTrigger><SelectValue placeholder="Select a student" /></SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {s.rollNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Book</Label>
              <Select value={selectedBookId} onValueChange={setSelectedBookId}>
                <SelectTrigger><SelectValue placeholder="Select a book" /></SelectTrigger>
                <SelectContent>
                  {unavailableBooks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {unavailableBooks.length === 0 && <p className="text-xs text-muted-foreground">Every book currently has a copy available.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleJoinQueue()} loading={isSaving}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
