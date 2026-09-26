"use client";

// Offline resilience for the one genuinely network-fragile moment in the
// marking flow: the final Submit. Marking itself (toggling switches) never
// touches the network - it's plain React state - so a dropped connection
// mid-class never loses anything until Submit is pressed. This queue exists
// for exactly that moment: if the PATCH to submit fails because the device
// has no network (not because the server rejected it), the submission is
// saved here instead of lost, and retried automatically once the browser
// reports being back online.
//
// Deliberately scoped to "Submit" only, not full offline roster caching - a
// faculty who goes offline BEFORE opening a period still needs a network
// round-trip to load the roster in the first place; this queue can't help
// with that, only with not losing a submission that was already filled in.

const STORAGE_KEY = "attendance_offline_submit_queue_v1";

export interface QueuedSubmission {
  queueId: string;
  sessionId: string;
  assignmentId: string;
  date: string;
  periodNumber: number | null;
  subjectName: string;
  sectionName: string;
  entries: { studentId: string; status: string | null }[];
  classNotes: string;
  expectedUpdatedAt?: string;
  queuedAt: string; // ISO - for "saved locally at HH:MM" display
}

function readQueue(): QueuedSubmission[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedSubmission[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedSubmission[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Storage full or unavailable (e.g. private browsing) - the submission
    // is lost the same way it always was before this feature existed;
    // nothing more to do here, the caller's own error toast still fires.
  }
}

export function getQueue(): QueuedSubmission[] {
  return readQueue();
}

// Replaces any existing queued attempt for the same session rather than
// stacking duplicates - e.g. the faculty edited a mark and hit Submit again
// while still offline; only the latest attempt should ever be sent.
export function enqueueSubmission(item: Omit<QueuedSubmission, "queueId" | "queuedAt">): QueuedSubmission {
  const filtered = readQueue().filter((q) => q.sessionId !== item.sessionId);
  const queued: QueuedSubmission = { ...item, queueId: `${item.sessionId}_${Date.now()}`, queuedAt: new Date().toISOString() };
  writeQueue([...filtered, queued]);
  return queued;
}

function removeFromQueue(queueId: string): void {
  writeQueue(readQueue().filter((q) => q.queueId !== queueId));
}

export type SyncOutcome =
  | { sessionId: string; result: "synced" }
  | { sessionId: string; result: "conflict"; error: string }
  | { sessionId: string; result: "rejected"; error: string }
  | { sessionId: string; result: "still-offline" };

// Attempts every queued submission in order. A thrown fetch (no network)
// stops the sweep immediately - no point burning through the rest of the
// queue against a connection that's still down, and every remaining item
// stays queued for the next retry. A real server response (even an error
// one) means we DO have connectivity, so that item is resolved one way or
// the other and the sweep continues: 409 (someone else updated this session
// while offline) or any other rejection can never succeed by blind retry,
// so both are removed from the queue rather than retried forever.
export async function trySyncQueue(): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const item of readQueue()) {
    try {
      const res = await fetch(`/api/college/student-attendance/${item.sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: item.entries,
          classNotes: item.classNotes,
          submit: true,
          expectedUpdatedAt: item.expectedUpdatedAt,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        removeFromQueue(item.queueId);
        outcomes.push({ sessionId: item.sessionId, result: "synced" });
      } else if (res.status === 409) {
        removeFromQueue(item.queueId);
        outcomes.push({ sessionId: item.sessionId, result: "conflict", error: json.error ?? "Updated elsewhere" });
      } else {
        removeFromQueue(item.queueId);
        outcomes.push({ sessionId: item.sessionId, result: "rejected", error: json.error ?? "Submission was rejected" });
      }
    } catch {
      outcomes.push({ sessionId: item.sessionId, result: "still-offline" });
      break;
    }
  }
  return outcomes;
}
