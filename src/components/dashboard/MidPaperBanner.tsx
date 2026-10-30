"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { deadlineLabel } from "@/lib/midBank/deadline";
import type { MidBankListItem } from "@/lib/midBank/clientTypes";

// "You have N question banks to prepare - due <date>" at the top of the Faculty
// dashboard while an Exam Cell question bank deadline is open for a subject they
// teach and their bank isn't complete (or not started). Fails silent - a passive
// heads-up, not an action the faculty took.
export function MidPaperBanner() {
  const [items, setItems] = useState<MidBankListItem[]>([]);

  useEffect(() => {
    fetch("/api/college/mid-question-banks")
      .then((r) => (r.ok ? (r.json() as Promise<{ items?: MidBankListItem[] }>) : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .catch(() => {});
  }, []);

  const todo = items.filter((i) => !i.deadline.locked && (i.myBank ? i.myBank.status !== "COMPLETE" : i.uncovered.length > 0));
  if (todo.length === 0) return null;
  const soonest = [...todo].sort((a, b) => a.deadline.deadline.localeCompare(b.deadline.deadline))[0];

  return (
    <Link
      href="/panel/mid-bank"
      className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm hover:bg-primary/10 transition-colors"
    >
      <BookOpen className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
      <p>
        {todo.length === 1 ? (
          <>Prepare the <strong>Mid {soonest.deadline.midNumber}</strong> question bank for <strong>{soonest.subject.name}</strong> ({soonest.branch})</>
        ) : (
          <>You have <strong>{todo.length} Mid question banks</strong> to prepare</>
        )}
        {" - "}{deadlineLabel(soonest.deadline.deadline)}. Open Question Bank.
      </p>
    </Link>
  );
}
