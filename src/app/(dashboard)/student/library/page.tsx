"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { BookLoan, BookReservation } from "@/types";

type LoanWithLive = BookLoan & { isOverdue: boolean; daysOverdue: number; liveFineAmount: number };

function toDate(v: unknown): Date {
  const t = v as { toDate?: () => Date };
  return typeof t?.toDate === "function" ? t.toDate() : new Date(v as string);
}

// Student's own borrowed books + reservation queue status - the cross-
// feature link the user asked for explicitly ("if any student borrows a
// book... the same will be reflected in the student dashboard also").
export default function StudentLibraryPage() {
  const [loans, setLoans] = useState<LoanWithLive[]>([]);
  const [reservations, setReservations] = useState<BookReservation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/student/me/library")
      .then((r) => r.json() as Promise<{ loans?: LoanWithLive[]; reservations?: BookReservation[] }>)
      .then((d) => {
        setLoans(d.loans ?? []);
        setReservations(d.reservations ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load library info" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="My Library" description="Books you've borrowed and your reservation queue" />
        <Button asChild variant="outline" size="sm">
          <Link href="/student">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Dashboard
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" /> Borrowed Books
            </h2>
            {loans.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground bg-muted/10">
                You have no books currently borrowed.
              </div>
            ) : (
              <div className="divide-y rounded-lg border sm:hidden">
                {loans.map((l) => (
                  <div key={l.id} className="p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">{l.bookTitle}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Due {toDate(l.dueAt).toDateString()}</p>
                    </div>
                    {l.isOverdue ? (
                      <Badge variant="destructive" className="shrink-0">
                        {l.daysOverdue}d overdue{l.liveFineAmount ? ` · ₹${l.liveFineAmount}` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">Active</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
            {loans.length > 0 && (
              <div className="hidden overflow-x-auto rounded-lg border sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="p-3 font-medium">Book</th>
                      <th className="p-3 font-medium">Due Date</th>
                      <th className="p-3 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map((l, i) => (
                      <tr key={l.id} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                        <td className="p-3 font-medium">{l.bookTitle}</td>
                        <td className="p-3 text-muted-foreground">{toDate(l.dueAt).toDateString()}</td>
                        <td className="p-3 text-right">
                          {l.isOverdue ? (
                            <Badge variant="destructive">
                              {l.daysOverdue}d overdue{l.liveFineAmount ? ` · ₹${l.liveFineAmount}` : ""}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Active</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-bold text-foreground">My Reservations</h2>
            {reservations.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground bg-muted/10">
                You&rsquo;re not waiting for any books right now.
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {reservations.map((r) => (
                  <div key={r.id} className="p-3.5 flex items-center justify-between gap-3">
                    <p className="font-medium text-sm text-foreground truncate">{r.bookTitle}</p>
                    <Badge variant={r.status === "NOTIFIED" ? "default" : "secondary"} className="shrink-0">
                      {r.status === "NOTIFIED" ? "Available - visit the library" : "Waiting"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
