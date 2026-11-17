"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Fingerprint, Loader2, MapPin, ScanFace, XCircle } from "lucide-react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CampusBoundaryMap } from "@/components/attendance/CampusBoundaryMap";
import { checkCampusGeofence, type CampusLocation } from "@/lib/attendance/geofence";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { nowInIndia } from "@/lib/leave/dayCounter";

// Check-in / check-out / register with a passkey: the registered phone's own fingerprint / face unlock signs a
// one-time challenge; the server verifies the signature (lib/attendance/passkeys.ts) plus the campus location.
// No camera. Used when the college's Self Check-In Method is PASSKEY (or EITHER and this person has a phone).

type Stage = "ready" | "working" | "late-reason" | "success" | "error";
const GOOD_ACCURACY_M = 150;
const LOCATION_WAIT_MS = 10000;

function guessDeviceLabel(): string {
  if (typeof navigator === "undefined") return "My phone";
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows laptop";
  return "My phone";
}

function webauthnMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError") return "Phone unlock was cancelled or timed out. Try again.";
  if (name === "InvalidStateError") return "This phone is already registered.";
  if (name === "NotSupportedError" || name === "SecurityError") return "This browser can't use phone fingerprint / face unlock here. Open the site in Chrome or Safari on your phone.";
  return (err as Error)?.message || "Unable to use phone unlock. Try again.";
}

export function PasskeyAttendanceDialog({ mode, open, onOpenChange, onSuccess, onUseFace }: {
  mode: "check-in" | "check-out" | "register";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  /** EITHER colleges: switch this attempt to the face scan. */
  onUseFace?: () => void;
}) {
  const isRegister = mode === "register";
  const label = mode === "check-in" ? "Check In" : mode === "check-out" ? "Check Out" : "Register This Phone";
  const [stage, setStage] = useState<Stage>("ready");
  const [errorMsg, setErrorMsg] = useState("");
  const [resultTime, setResultTime] = useState("");
  const [deviceLabel, setDeviceLabel] = useState(guessDeviceLabel);
  const [lateReason, setLateReason] = useState("");
  // Mounted when the dialog opens, so the client's clock at that moment is the first guess (the server decides).
  const [isLate, setIsLate] = useState(() => mode === "check-in" && isLateCheckIn(nowInIndia().timeHHMM, null, null));
  const [campusLocation, setCampusLocation] = useState<CampusLocation | null>(null);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const coordsRef = useRef<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const locationErrorRef = useRef<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lateAfterRef = useRef<string | null>(null);

  // Location starts as the dialog opens (check-in / check-out only) and keeps the most precise fix.
  useEffect(() => {
    if (!open || isRegister) return;
    coordsRef.current = null;
    locationErrorRef.current = null;
    fetch("/api/college/attendance/campus-location")
      .then((r) => r.json() as Promise<{ campusLocation: CampusLocation | null; lateAfter?: string }>)
      .then((d) => {
        setCampusLocation(d.campusLocation);
        if (d.lateAfter) {
          lateAfterRef.current = d.lateAfter;
          if (mode === "check-in") setIsLate(isLateCheckIn(nowInIndia().timeHHMM, null, d.lateAfter));
        }
      })
      .catch(() => undefined);
    if (!navigator.geolocation) { locationErrorRef.current = "Geolocation is not supported by this browser."; return; }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
        if (!coordsRef.current || next.accuracy <= coordsRef.current.accuracy) {
          coordsRef.current = next;
          setUserCoords({ latitude: next.latitude, longitude: next.longitude });
        }
      },
      () => { locationErrorRef.current = "Unable to get your location. Check location permissions and try again."; },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
    );
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, [open, isRegister, mode]);

  function fail(message: string) {
    setErrorMsg(message);
    setStage("error");
  }

  async function awaitLocation(): Promise<boolean> {
    const deadline = Date.now() + LOCATION_WAIT_MS;
    while (Date.now() < deadline) {
      if (coordsRef.current && coordsRef.current.accuracy <= GOOD_ACCURACY_M) return true;
      if (locationErrorRef.current && !coordsRef.current) return false;
      await new Promise((r) => setTimeout(r, 300));
    }
    return !!coordsRef.current;
  }

  async function register() {
    setStage("working");
    try {
      const optRes = await fetch("/api/college/attendance/passkey/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "options" }),
      });
      const options = await optRes.json();
      if (!optRes.ok) return fail(options.error ?? "Unable to register this phone.");
      const response = await startRegistration({ optionsJSON: options });
      const res = await fetch("/api/college/attendance/passkey/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "verify", response, label: deviceLabel }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) return fail(json.error ?? "Unable to register this phone.");
      setStage("success");
      onSuccess();
    } catch (err) {
      fail(webauthnMessage(err));
    }
  }

  // One phone unlock -> signed response -> check-in / check-out with the location.
  async function attend(withReason: boolean) {
    setStage("working");
    try {
      const optRes = await fetch("/api/college/attendance/passkey/options", { method: "POST" });
      const options = await optRes.json();
      if (!optRes.ok) return fail(options.error ?? "Unable to start phone unlock.");
      const passkey = await startAuthentication({ optionsJSON: options });
      if (!(await awaitLocation())) {
        return fail(locationErrorRef.current ?? "Still waiting on your location — check location permissions and try again.");
      }
      const c = coordsRef.current!;
      const late = mode === "check-in" && (withReason || isLateCheckIn(nowInIndia().timeHHMM, null, lateAfterRef.current));
      if (late && !lateReason.trim()) {
        // Asked before signing next time; this signature would be used up by a refused request.
        setIsLate(true);
        setStage("late-reason");
        return;
      }
      const res = await fetch(`/api/college/attendance/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy, passkey,
          ...(late ? { lateReason: lateReason.trim() } : {}),
        }),
      });
      const json = await res.json() as { error?: string; code?: string; checkIn?: string; checkOut?: string };
      if (!res.ok && json.code === "LATE_REASON_REQUIRED") {
        // The server's clock says late: ask the reason, then one more phone unlock (the signature was used).
        setIsLate(true);
        setStage("late-reason");
        return;
      }
      if (!res.ok) return fail(json.error ?? "Unable to mark attendance.");
      setResultTime(json.checkIn ?? json.checkOut ?? "");
      setStage("success");
      onSuccess();
    } catch (err) {
      fail(webauthnMessage(err));
    }
  }

  const showReason = mode === "check-in" && isLate && (stage === "ready" || stage === "late-reason");
  const reasonMissing = showReason && !lateReason.trim();
  const geofence = !isRegister && campusLocation && userCoords ? checkCampusGeofence(userCoords.latitude, userCoords.longitude, campusLocation) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {isRegister
              ? "Registers this phone for check-in. Each check-in is then one tap and your phone's own fingerprint or face unlock."
              : "Unlock with your phone's fingerprint or face. Your location must be inside the campus."}
          </DialogDescription>
        </DialogHeader>

        {geofence && stage !== "success" && campusLocation && userCoords && (
          <div className="space-y-2">
            <p className={`text-sm font-medium flex items-center gap-1.5 ${geofence.withinBounds ? "text-green-600" : "text-destructive"}`}>
              <MapPin className="h-4 w-4" />
              {geofence.withinBounds ? "You're within the campus boundary" : (geofence.message ?? "You appear to be outside the campus boundary")}
            </p>
            <CampusBoundaryMap campusLocation={campusLocation} userLocation={userCoords} className="h-36 w-full rounded-lg border" />
          </div>
        )}
        {!isRegister && !userCoords && stage === "ready" && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> Finding your location…</p>
        )}

        {showReason && (
          <div className="space-y-1.5">
            <Label htmlFor="pk-late-reason" className="text-sm font-medium text-amber-700">You&rsquo;re checking in late — why?</Label>
            <Textarea id="pk-late-reason" rows={2} placeholder="traffic, a personal errand, a delayed bus..." value={lateReason} onChange={(e) => setLateReason(e.target.value)} />
            <p className="text-xs text-muted-foreground">Your HOD and Principal will see this reason on the attendance report.</p>
          </div>
        )}

        {isRegister && stage === "ready" && (
          <div className="space-y-1.5">
            <Label htmlFor="pk-label">Phone Name</Label>
            <Input id="pk-label" value={deviceLabel} maxLength={60} onChange={(e) => setDeviceLabel(e.target.value)} />
            <p className="text-xs text-muted-foreground">Shown in your list of registered phones. Register on the phone you carry every day.</p>
          </div>
        )}

        <div className="flex flex-col items-center gap-2 py-4 text-center">
          {stage === "success" ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="font-medium">{isRegister ? "Phone registered." : `${label} recorded at ${resultTime}.`}</p>
            </>
          ) : stage === "error" ? (
            <>
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
            </>
          ) : stage === "working" ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Follow your phone&apos;s prompt…</p>
            </>
          ) : (
            <Fingerprint className="h-12 w-12 text-primary" />
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {onUseFace && !isRegister && stage !== "success" && stage !== "working" ? (
            <Button variant="ghost" onClick={onUseFace}><ScanFace className="h-4 w-4 mr-1.5" />Use Face Scan Instead</Button>
          ) : <span />}
          {stage === "success" ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : stage === "error" ? (
            <Button variant="outline" onClick={() => setStage("ready")}>Try Again</Button>
          ) : stage === "late-reason" ? (
            <Button onClick={() => void attend(true)} disabled={!lateReason.trim()}><Fingerprint className="h-4 w-4 mr-1.5" />Unlock &amp; Check In</Button>
          ) : stage === "ready" ? (
            <Button onClick={() => void (isRegister ? register() : attend(false))} disabled={reasonMissing || (isRegister && !deviceLabel.trim())}>
              <Fingerprint className="h-4 w-4 mr-1.5" />{isRegister ? "Register This Phone" : `${label} With Phone Unlock`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
