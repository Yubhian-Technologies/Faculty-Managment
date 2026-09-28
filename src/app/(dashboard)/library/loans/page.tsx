"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCw, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { daysOverdue, isOverdue } from "@/lib/library/fine";
import type { Book, BookLoan, StudentRecord } from "@/types";

type LoanRow = BookLoan & Record<string, unknown>;

function toDate(v: unknown): Date {
  const t = v as { toDate?: () => Date };
  return typeof t?.toDate === "function" ? t.toDate() : new Date(v as string);
}

export default function LibraryLoansPage() {
  const [loans, setLoans] = useState<LoanRow[]>([]);
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
      const [loansRes, booksRes, studentsRes] = await Promise.all([
        fetch("/api/college/library/loans"),
        fetch("/api/college/library/books"),
        fetch("/api/college/students"),
      ]);
      const loansJson = (await loansRes.json()) as { loans?: BookLoan[] };
      const booksJson = (await booksRes.json()) as { books?: Book[] };
      const studentsJson = (await studentsRes.json()) as { students?: (StudentRecord & { id: string })[] };
      setLoans((loansJson.loans ?? []) as LoanRow[]);
      setBooks(booksJson.books ?? []);
      setStudents(studentsJson.students ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load loans" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const borrowableBooks = useMemo(() => books.filter((b) => b.availableCopies > 0), [books]);

  async function handleBorrow() {
    if (!selectedStudentId || !selectedBookId) {
      toast({ variant: "destructive", title: "Select a student and a book" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/library/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudentId, bookId: selectedBookId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; code?: string };
      if (!res.ok || !json.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to record loan" });
        return;
      }
      toast({ variant: "success", title: "Book issued" });
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

  async function handleReturn(loan: LoanRow) {
    try {
      const res = await fetch(`/api/college/library/loans/${loan.id}/return`, { method: "PATCH" });
      const json = (await res.json()) as { ok?: boolean; error?: string; fineAmount?: number };
      if (!res.ok || !json.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to return book" });
        return;
      }
      toast({
        variant: "success",
        title: "Book returned",
        description: json.fineAmount ? `Overdue fine: ₹${json.fineAmount}` : undefined,
      });
      void loadAll();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    }
  }

  async function handleRenew(loan: LoanRow) {
    try {
      const res = await fetch(`/api/college/library/loans/${loan.id}/renew`, { method: "PATCH" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to renew loan" });
        return;
      }
      toast({ variant: "success", title: "Loan renewed" });
      void loadAll();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    }
  }

  const columns: Column<LoanRow>[] = [
    { key: "bookTitle", header: "Book", render: (l) => <span className="font-medium">{l.bookTitle}</span> },
    { key: "studentName", header: "Student", render: (l) => `${l.studentName} (${l.studentRollNumber})` },
    { key: "dueAt", header: "Due", hideOnMobile: true, render: (l) => toDate(l.dueAt).toDateString() },
    {
      key: "status",
      header: "Status",
      render: (l) => {
        if (l.status === "RETURNED") return <Badge variant="secondary">Returned</Badge>;
        const overdue = isOverdue(toDate(l.dueAt));
        return overdue ? (
          <Badge variant="destructive">{daysOverdue(toDate(l.dueAt))}d overdue</Badge>
        ) : (
          <Badge variant="default">Active</Badge>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromCsv: true,
      render: (l) =>
        l.status === "RETURNED" ? null : (
          <div className="flex items-center gap-1 justify-end">
            <button onClick={() => void handleRenew(l)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground" title="Renew">
              <RotateCw className="h-4 w-4" />
            </button>
            <button onClick={() => void handleReturn(l)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground" title="Return">
              <Undo2 className="h-4 w-4" />
            </button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Book Loans"
        description="Issue, renew and return books"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Issue Book
          </Button>
        }
      />

      <DataTable
        data={loans}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by book or student"
        searchKeys={["bookTitle", "studentName", "studentRollNumber"]}
        keyExtractor={(l) => l.id}
        emptyTitle="No loans yet"
        csvFilename="library-loans"
        paginate
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue Book</DialogTitle>
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
                  {borrowableBooks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.title} ({b.availableCopies} available)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {borrowableBooks.length === 0 && (
                <p className="text-xs text-muted-foreground">No books currently have a copy available - use the Reservations page to queue a student instead.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleBorrow()} loading={isSaving}>Issue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
