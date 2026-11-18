// Which device made a passkey check-in, and whether that counts as "the registered phone".
//
// A passkey is copied to every device of the same Apple / Google account (iCloud Keychain, Google Password
// Manager), so a laptop signed in to that account can sign with the "iPhone" passkey without the phone being
// there. Check-in therefore accepts a passkey signature only:
//   ON_PHONE      - made on a phone (the phone's own screen lock), or
//   NEARBY_PHONE  - made on a computer through the phone held near it (the browser's "use a phone" QR code,
//                   which needs the phone within Bluetooth range: WebAuthn reports it as "cross-platform").
// A signature from the computer's own copy (Touch ID / Windows Hello / the computer's password) is refused.
//
// Honest limit: the device kind (User-Agent / client hints / touch points) and `authenticatorAttachment` are
// reported by the browser, not signed by the passkey, so someone who edits the request by hand can pass. This
// stops the everyday case - a laptop quietly holding a synced copy - and the evidence records what was claimed.

export type DeviceKind = "PHONE" | "COMPUTER";
export type PasskeyRoute = "ON_PHONE" | "NEARBY_PHONE";

export const COMPUTER_COPY_MESSAGE =
  "Unable to check in with this computer's copy of your passkey. Use your registered phone, or choose \"Use a phone or tablet\" when asked and scan the QR code with that phone.";
export const REGISTER_ON_PHONE_MESSAGE =
  "Unable to register a computer for check-in. Open Vishnu People on the phone you carry every day and register it there.";

/**
 * PHONE when the browser says it is a mobile device: Chromium's `Sec-CH-UA-Mobile: ?1`, a phone User-Agent, or
 * an Apple "desktop website" User-Agent (iPhone / iPad Safari send a Mac one) on a touch screen (`touchPoints`,
 * posted by the page - a Mac has none). Everything else - Mac, Windows, Linux, Android tablets - is a COMPUTER.
 */
export function deviceKindOf(headers: Headers, touchPoints?: unknown): DeviceKind {
  if (headers.get("sec-ch-ua-mobile") === "?1") return "PHONE";
  const ua = headers.get("user-agent") ?? "";
  if (/iPhone|iPod/i.test(ua)) return "PHONE";
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return "PHONE";
  const touch = typeof touchPoints === "number" && Number.isFinite(touchPoints) ? touchPoints : 0;
  if (/Macintosh/i.test(ua) && touch > 1) return "PHONE";
  return "COMPUTER";
}

/** How a check-in signature was made, or null when it came from a computer's own copy (refused). */
export function passkeyRouteOf(authenticatorAttachment: unknown, kind: DeviceKind): PasskeyRoute | null {
  if (authenticatorAttachment === "cross-platform") return "NEARBY_PHONE";
  if (kind === "PHONE") return "ON_PHONE";
  return null;
}

/** Asks a computer's browser to go straight to "use a phone" (QR) instead of offering its own copy first. */
export function preferNearbyPhone<T extends { allowCredentials?: { id: string; transports?: unknown }[] }>(options: T): T & { hints: string[] } {
  return {
    ...options,
    hints: ["hybrid"],
    ...(options.allowCredentials ? { allowCredentials: options.allowCredentials.map((c) => ({ ...c, transports: ["hybrid"] })) } : {}),
  };
}

export function routeLabel(route: PasskeyRoute | undefined): string {
  return route === "NEARBY_PHONE" ? "on a computer, with the phone nearby (QR)" : "on the phone";
}
