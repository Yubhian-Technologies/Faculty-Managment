// The location an API call may act on. Only a Super Admin may name a location other than their
// own; every location-scoped role is held to the one on its session, whatever the request body
// or query string says. Routes that took `body.locationId || session.locationId` directly let a
// department head or staff admin of one location read or change another location's data.
export function scopedLocationId(
  session: { role: string; locationId?: string | null },
  requested: string | null | undefined
): string {
  if (session.role === "SUPER_ADMIN") return requested || session.locationId || "";
  return session.locationId || "";
}
