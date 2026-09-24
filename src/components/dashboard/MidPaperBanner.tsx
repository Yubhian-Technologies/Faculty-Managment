"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { MidPaperAssignment } from "@/types";

// "You've been assigned to prepare Mid X for <Subject>" - shown at the top of
// the Faculty dashboard whenever the HOD's Mid Paper Setter has handed them
// one. Fails silent (no assignments = no banner) rather than toasting, since
// this is a passive heads-up, not an action the faculty took.
export function MidPaperBanner() {
  const [assignments, setAssignments] = useState<MidPaperAssignment[]>([]);

  useEffect(() => {
    fetch("/api/college/mid-paper-assignments")
      .then((r) => r.json() as Promise<{ assignments?: MidPaperAssignment[] }>)
      .then((d) => setAssignments(d.assignments ?? []))
      .catch(() => {});
  }, []);

  if (assignments.length === 0) return null;

  return (
    <Link
      href="/panel/mid-bank"
      className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm hover:bg-primary/10 transition-colors"
    >
      <BookOpen className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
      <div>
        {assignments.length === 1 ? (
          <p>
            You&apos;re able to prepare the <strong>Mid {assignments[0].midNumber}</strong> question bank for{" "}
            <strong>{assignments[0].subjectName}</strong>.
          </p>
        ) : (
          <p>
            You&apos;re able to prepare question banks for <strong>{assignments.length} Mid papers</strong> - see Add Mid Bank.
          </p>
        )}
      </div>
    </Link>
  );
}
