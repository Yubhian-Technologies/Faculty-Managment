// What the attendance report shows about HOW a self check-in was proved - read from the record's `checkInProof`
// (attendanceProof.ts evidence). Pure, shared by the report route and its tests.

export interface CheckInHow {
  method: "FACE" | "PASSKEY";
  /** The registered phone's name (phone unlock only). */
  device?: string;
  /** Made with a face / phone registered in the last NEW_REGISTRATION_DAYS days - a swap stands out. */
  newDevice?: boolean;
}

/** A registration counts as new for this many days. */
export const NEW_REGISTRATION_DAYS = 3;

export function isNewRegistration(registeredAt: Date | null | undefined, now: number): boolean {
  return !!registeredAt && now - registeredAt.getTime() < NEW_REGISTRATION_DAYS * 86_400_000;
}

export function checkInHowOf(rec: object): CheckInHow | null {
  const p = (rec as { checkInProof?: unknown }).checkInProof as { method?: string; deviceLabel?: string; newRegistration?: boolean } | undefined;
  if (!p?.method) return null;
  const method: CheckInHow["method"] = p.method === "PASSKEY" ? "PASSKEY" : "FACE";
  return {
    method,
    ...(method === "PASSKEY" && p.deviceLabel ? { device: p.deviceLabel } : {}),
    ...(p.newRegistration ? { newDevice: true } : {}),
  };
}
