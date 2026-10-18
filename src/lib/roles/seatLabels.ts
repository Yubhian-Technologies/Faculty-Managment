import type { Firestore } from "firebase-admin/firestore";
import { ROLE_LABELS } from "@/types/core";
import type { RoleSeat } from "@/types/roleSeats";
import { listSeats } from "@/lib/roles/seats";

// How a held seat reads next to a person in the Faculty lists: "HOD of CSE",
// "Principal", "R&D Coordinator - CSE". Display only - what a person may do is
// still decided by the guards, never by this text.

/** One seat as a short phrase. */
export function seatPhrase(seat: Pick<RoleSeat, "role" | "label" | "departmentName">): string {
  const dept = seat.departmentName?.trim();
  if (seat.role === "HOD" && dept) return `HOD of ${dept}`;
  if (dept) return `${ROLE_LABELS[seat.role] ?? seat.role} - ${dept}`;
  return seat.label?.trim() || ROLE_LABELS[seat.role] || String(seat.role);
}

/** Login uid -> the seats they hold (active seats only). One read of the seats collection. */
export async function loadSeatPhrasesByHolder(db: Firestore, collegeId: string): Promise<Map<string, string[]>> {
  const seats = await listSeats(db, collegeId);
  const byHolder = new Map<string, string[]>();
  for (const seat of seats) {
    if (!seat.holderUid) continue;
    const list = byHolder.get(seat.holderUid) ?? [];
    list.push(seatPhrase(seat));
    byHolder.set(seat.holderUid, list);
  }
  return byHolder;
}

/**
 * Login uid -> the seats they hold, as both the short phrases AND the role codes ("HOD", "PRINCIPAL" ...), from ONE read of the
 * seats collection. The codes let a list put the HOD and the Principal first without parsing display text.
 */
export async function loadSeatsByHolder(db: Firestore, collegeId: string): Promise<Map<string, { phrases: string[]; roles: string[] }>> {
  const seats = await listSeats(db, collegeId);
  const byHolder = new Map<string, { phrases: string[]; roles: string[] }>();
  for (const seat of seats) {
    if (!seat.holderUid) continue;
    const entry = byHolder.get(seat.holderUid) ?? { phrases: [], roles: [] };
    entry.phrases.push(seatPhrase(seat));
    entry.roles.push(String(seat.role));
    byHolder.set(seat.holderUid, entry);
  }
  return byHolder;
}
