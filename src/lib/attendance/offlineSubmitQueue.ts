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
  // Marked on the phone with no internet: the phone's time at Submit. Sent as { offline: { markedAt } } so the
  // server accepts it until the end of that day and flags it "Marked offline" for the HOD.
  markedAt?: string;
  // The period was opened from the saved day (no internet): it doesn't exist on the server yet, so the sync
  // creates it first (POST), then submits.
  isNew?: boolean;
  // The server refused it for a reason a retry can't fix by itself (e.g. a new student to mark). Kept - never
  // silently dropped - and shown on the page until it goes through or the faculty discards it.
  lastError?: string;
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
  | { sessionId: string; result: "rejected"; error: string; repeat?: boolean }
  | { sessionId: string; result: "still-offline" }
  // Transient server answer (5xx, 408, 429, 401): the marks stay queued for the next attempt.
  | { sessionId: string; result: "retry"; status: number };

// "Try again later", not "this can never work". Dropping the queued marks on one
// of these would lose the faculty's only copy.
const isTransientStatus = (status: number) => status >= 500 || status === 408 || status === 429 || status === 401;

// Attempts every queued submission in order. A thrown fetch (no network)
// stops the sweep immediately - no point burning through the rest of the
// queue against a connection that's still down, and every remaining item
// stays queued for the next retry. A real server response (even an error
// one) means we DO have connectivity, so that item is resolved one way or
// the other and the sweep continues: 409 (someone else updated / submitted
// this session meanwhile) is removed; any other refusal is KEPT with its reason
// (`lastError`) - the faculty's only copy is never silently dropped - and shown
// on the page until it goes through or they discard it.
export async function trySyncQueue(): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const item of readQueue()) {
    try {
      const offline = item.markedAt ? { markedAt: item.markedAt } : undefined;
      let sessionId = item.sessionId;
      if (item.isNew) {
        // Opened from the saved day: create the period's attendance on the server first (same day only).
        const created = await fetch("/api/college/student-attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentId: item.assignmentId, date: item.date, periodNumber: item.periodNumber, offline }),
        });
        const cj = (await created.json().catch(() => ({}))) as { error?: string; session?: { id?: string } };
        if (!created.ok || !cj.session?.id) {
          if (isTransientStatus(created.status)) {
            outcomes.push({ sessionId, result: "retry", status: created.status });
            break;
          }
          const error = cj.error ?? "Unable to open this period on the server";
          const fresh = setItemError(item.queueId, error);
          outcomes.push({ sessionId, result: "rejected", error, ...(fresh ? {} : { repeat: true }) });
          continue;
        }
        sessionId = cj.session.id;
        markCreated(item.queueId, sessionId);
      }
      const res = await fetch(`/api/college/student-attendance/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: item.entries,
          classNotes: item.classNotes,
          submit: true,
          expectedUpdatedAt: item.isNew ? undefined : item.expectedUpdatedAt,
          offline,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        removeFromQueue(item.queueId);
        outcomes.push({ sessionId, result: "synced" });
      } else if (isTransientStatus(res.status)) {
        outcomes.push({ sessionId, result: "retry", status: res.status });
        break;
      } else if (res.status === 409) {
        removeFromQueue(item.queueId);
        outcomes.push({ sessionId, result: "conflict", error: json.error ?? "Updated elsewhere" });
      } else {
        // Kept on the device with the reason (e.g. a student added since the list was saved): opening the period
        // online shows these marks, and the faculty completes and submits it there.
        const error = json.error ?? "Submission was rejected";
        const fresh = setItemError(item.queueId, error);
        outcomes.push({ sessionId, result: "rejected", error, ...(fresh ? {} : { repeat: true }) });
      }
    } catch {
      outcomes.push({ sessionId: item.sessionId, result: "still-offline" });
      break;
    }
  }
  return outcomes;
}

/** Records why the server refused an item; false when it is the same reason as last time (no repeat message). */
function setItemError(queueId: string, error: string): boolean {
  const q = readQueue();
  const item = q.find((x) => x.queueId === queueId);
  if (!item) return false;
  const fresh = item.lastError !== error;
  item.lastError = error;
  writeQueue(q);
  return fresh;
}

/** A period created on the server from the saved day: later syncs only submit it. */
function markCreated(queueId: string, sessionId: string): void {
  const q = readQueue();
  const item = q.find((x) => x.queueId === queueId);
  if (!item) return;
  item.isNew = false;
  item.sessionId = sessionId;
  writeQueue(q);
}

/** The faculty chose to drop a saved submission the server keeps refusing. */
export function discardQueued(queueId: string): void {
  removeFromQueue(queueId);
}
