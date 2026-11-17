"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, MapPin, ScanFace, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CampusBoundaryMap } from "@/components/attendance/CampusBoundaryMap";
import {
  loadFaceModels, warmFaceModels, getFaceDescriptor, captureVideoFrame, captureDescriptors,
  calibrateFaceBaseline, waitForGuidedTurn, waitForGuidedRecenter,
  FACE_MATCH_THRESHOLD,
} from "@/lib/attendance/faceMatch";
import { bestDistance } from "@/lib/attendance/faceThreshold";
import { checkCampusGeofence, type CampusLocation } from "@/lib/attendance/geofence";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { nowInIndia } from "@/lib/leave/dayCounter";
import { PasskeyAttendanceDialog } from "@/components/attendance/PasskeyAttendanceDialog";

// Same 3-step guided liveness sequence for both Register and Check-in/out —
// one instruction on screen at a time, in this order. "Tilt" accepts a head
// turn to either side (see waitForGuidedTurn call below): camera mirroring
// varies by device, so which physical direction reads as "left" on screen
// isn't reliable to assert without real-hardware testing — what matters here
// is that a deliberate head movement away from center happened at all.
// The blink step was dropped: through this landmark model a real blink barely moves the eye ratio, so it
// failed often and cost retries. The head turn is the clear signal; then look back for the capture.
const LIVENESS_STEPS = ["Turn your head to either side", "Look straight at the camera"];

// Deliberately slow: an instruction stays up at least this long even if the
// action is detected almost instantly, so there's time to read and react to
// it — and after detection, a short "Got it" confirmation holds before the
// next instruction appears, rather than jumping straight to it.
const STEP_MIN_DISPLAY_MS = 600;
const STEP_CONFIRM_HOLD_MS = 450;
// Location is precise enough for the server (attendanceProof MAX_LOCATION_ACCURACY_M) at this accuracy.
const GOOD_ACCURACY_M = 150;
// How long the final step waits for a precise fix before sending the best one it has.
const LOCATION_WAIT_MS = 10000;

// "reason-first": late when Check In was tapped - the reason is asked BEFORE the camera opens, and a
// successful scan then checks in at once. "late-reason": became late during the scan (or the server's
// clock says so) - the reason is asked AFTER, reusing the scan already made.
type Stage = "init" | "reason-first" | "camera-ready" | "guided-liveness" | "capturing" | "verifying" | "late-reason" | "submitting" | "success" | "error";

interface MarkAttendanceDialogProps {
  // "register" runs the one-time enrollment flow (capture → extract → store
  // the face descriptor) instead of a check-in/check-out - see
  // /api/college/attendance/face-registration. No geofence involved: it's
  // not an attendance event, just capturing a reference.
  mode: "check-in" | "check-out" | "register";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function FaceAttendanceDialog({ mode, open, onOpenChange, onSuccess }: MarkAttendanceDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stage, setStage] = useState<Stage>("init");
  const [errorMsg, setErrorMsg] = useState("");
  const [resultTime, setResultTime] = useState("");
  const coordsRef = useRef<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  // The college's Late cut-off (Attendance Timings), from campus-location; null until known = 09:05.
  const lateAfterRef = useRef<string | null>(null);
  // The face descriptor captured for this attempt and when - sent to the server,
  // which does the real comparison against the registered one (attendanceProof.ts).
  const capturedProofRef = useRef<{ descriptor: number[]; capturedAt: number } | null>(null);
  const cancelledRef = useRef(false);
  // GPS runs from the moment the dialog opens (also while a late reason is typed), keeping the most precise fix.
  const watchIdRef = useRef<number | null>(null);
  const locationErrorRef = useRef<string | null>(null);
  // The registered face samples, fetched as the dialog opens (not after the scan) - for the early match feedback.
  const samplesRef = useRef<Promise<number[][] | null> | null>(null);
  const [campusLocation, setCampusLocation] = useState<CampusLocation | null>(null);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepHint, setStepHint] = useState<string | null>(null);
  const [stepConfirmed, setStepConfirmed] = useState(false);
  // Best-effort client-side read of "is it past 09:05 IST right now" (see
  // lib/attendance/lateStatus.ts) - just gates whether this dialog asks for a
  // reason up front. The server (api/college/attendance/check-in) re-checks
  // with its own clock and the person's actual permittedCheckInTime (not
  // known here) and is the real authority - it rejects a late check-in with
  // no reason regardless of what this flag decided.
  const [isLate, setIsLate] = useState(false);
  const [lateReason, setLateReason] = useState("");
  // Held between face verification and the submit that follows the late-reason
  // step, so the reason screen does not have to re-run the match.

  const isRegister = mode === "register";
  const label = mode === "check-in" ? "Check In" : mode === "check-out" ? "Check Out" : "Register Face";

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function fail(message: string) {
    // Every other failure point below (bad blink/tilt read, no face found,
    // mismatch, still waiting on location...) happens well before the two
    // success-path stopCamera() calls near the final submit - without this,
    // the stream from startCamera() keeps running (and the OS/browser camera
    // indicator stays lit) the whole time the dialog sits on the error
    // screen, and "Try Again" would leak it entirely by requesting a second
    // stream on top of it. The error screen never renders the <video>
    // preview anyway, so there's nothing to keep the camera alive for here.
    stopCamera();
    setErrorMsg(message);
    setStage("error");
  }

  function stopLocation() {
    if (watchIdRef.current != null) navigator.geolocation?.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }

  // Started as soon as the dialog opens, in parallel with the camera and the face models; keeps the most
  // precise fix seen (GPS sharpens over a few seconds indoors).
  function startLocation() {
    if (isRegister || watchIdRef.current != null) return;
    locationErrorRef.current = null;
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
  }

  // Waits (up to LOCATION_WAIT_MS) for a precise fix; returns whatever is best by then.
  async function awaitLocation(): Promise<boolean> {
    const deadline = Date.now() + LOCATION_WAIT_MS;
    while (Date.now() < deadline && !cancelledRef.current) {
      if (coordsRef.current && coordsRef.current.accuracy <= GOOD_ACCURACY_M) return true;
      if (locationErrorRef.current && !coordsRef.current) return false;
      await new Promise((r) => setTimeout(r, 300));
    }
    return !!coordsRef.current;
  }

  // Warm-up while the page is open (before anyone taps Check In): face models downloaded and compiled, and
  // the registered samples fetched - so the scan itself starts immediately.
  useEffect(() => {
    const warm = () => { void warmFaceModels().catch(() => undefined); };
    const w = window as Window & { requestIdleCallback?: (f: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(warm); else setTimeout(warm, 1200);
  }, []);

  function loadSamples() {
    samplesRef.current = fetch("/api/college/attendance/face-registration")
      .then((r) => r.json() as Promise<{ embeddings?: number[][]; embedding?: number[] | null }>)
      .then((d) => (d.embeddings?.length ? d.embeddings : d.embedding ? [d.embedding] : []))
      .catch(() => null);
  }

  async function startCamera() {
    // Defensive: guards against ever running two live getUserMedia streams
    // at once (e.g. a caller invoking this again before the previous one
    // was released) - stopCamera() is a no-op if nothing's running.
    stopCamera();
    setStage("init");
    setErrorMsg("");
    setUserCoords(null);
    capturedProofRef.current = null;

    if (mode === "check-in") {
      setIsLate(isLateCheckIn(nowInIndia().timeHHMM, null, lateAfterRef.current));
    }

    if (!isRegister) {
      fetch("/api/college/attendance/campus-location")
        .then((r) => r.json() as Promise<{ campusLocation: CampusLocation | null; lateAfter?: string }>)
        .then((d) => {
          setCampusLocation(d.campusLocation);
          // The college's own Late cut-off (Attendance Timings) - the server decides anyway; this is the heads-up.
          if (d.lateAfter) {
            lateAfterRef.current = d.lateAfter;
            if (mode === "check-in") setIsLate(isLateCheckIn(nowInIndia().timeHHMM, null, d.lateAfter));
          }
        })
        .catch(() => { /* non-critical - the map is a heads-up, not the actual check */ });

      startLocation();
    }

    try {
      await loadFaceModels();
      // A modest resolution: plenty for a face filling the frame, and every frame is cheaper to analyse.
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStage("camera-ready");
    } catch {
      fail("Unable to access your camera. Check camera permissions and try again.");
    }
  }

  useEffect(() => {
    void (async () => {
      if (open) {
        cancelledRef.current = false;
        coordsRef.current = null;
        startLocation();
        if (!isRegister) loadSamples();
        // Late already: ask why first, then open the camera (Continue to Face Scan).
        if (mode === "check-in" && isLateCheckIn(nowInIndia().timeHHMM, null, lateAfterRef.current)) {
          setIsLate(true);
          setStage("reason-first");
          return;
        }
        await startCamera();
      } else {
        cancelledRef.current = true;
        stopCamera();
        stopLocation();
        setStage("init");
        setErrorMsg("");
        setResultTime("");
        setIsLate(false);
        setLateReason("");
      }
    })();
    return () => { cancelledRef.current = true; stopCamera(); stopLocation(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Runs one guided step's detector, then — only once the action is actually
  // detected — holds the instruction on screen for a minimum read time and
  // shows a brief confirmation before returning, so the caller can safely
  // move to the next step without it feeling instant or automatic.
  async function runLivenessStep(detect: () => Promise<boolean>): Promise<boolean> {
    setStepHint(null);
    setStepConfirmed(false);
    const startedAt = Date.now();

    const detected = await detect();
    if (cancelledRef.current || !detected) return false;

    const elapsed = Date.now() - startedAt;
    if (elapsed < STEP_MIN_DISPLAY_MS) {
      await new Promise((r) => setTimeout(r, STEP_MIN_DISPLAY_MS - elapsed));
    }
    if (cancelledRef.current) return false;

    setStepHint(null);
    setStepConfirmed(true);
    await new Promise((r) => setTimeout(r, STEP_CONFIRM_HOLD_MS));
    return !cancelledRef.current;
  }

  // Shared guided liveness check (turn → re-center) used by
  // both Register and Check-in/out. Returns true once both steps are
  // confirmed; on failure it has already called fail() with a message.
  async function runGuidedLiveness(video: HTMLVideoElement): Promise<boolean> {
    const abortCheck = () => cancelledRef.current;
    try {
      setStepHint(null);
      setStepConfirmed(false);

      const baseline = await calibrateFaceBaseline(video, { shouldAbort: abortCheck });
      if (cancelledRef.current) return false;
      if (!baseline) {
        fail("Unable to get a clear view of your face. Try again.");
        return false;
      }

      setStepIndex(0);
      const tiltOk = await runLivenessStep(async () =>
        (await waitForGuidedTurn(video, baseline.yawOffset, { shouldAbort: abortCheck, onHint: setStepHint })) !== null
      );
      if (cancelledRef.current) return false;
      if (!tiltOk) {
        fail("No head movement detected. Try again.");
        return false;
      }

      setStepIndex(1);
      const centerOk = await runLivenessStep(() =>
        waitForGuidedRecenter(video, baseline.yawOffset, { shouldAbort: abortCheck, onHint: setStepHint })
      );
      if (cancelledRef.current) return false;
      if (!centerOk) {
        fail("Try again.");
        return false;
      }

      return true;
    } catch (err) {
      console.error("[MarkAttendanceDialog] guided liveness failed", err);
      fail("Unable to complete the request verifying your face. Try again.");
      return false;
    }
  }

  async function handleStart() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    setStage("guided-liveness");
    const ok = await runGuidedLiveness(video);
    if (cancelledRef.current || !ok) return;
    if (isRegister) {
      await finishRegistration(video);
    } else {
      await handleCapture(video);
    }
  }

  async function finishRegistration(video: HTMLVideoElement) {
    setStage("capturing");
    try {
      // A few frames, a moment apart - check-in then matches the closest of them.
      const descriptors = await captureDescriptors(video, 3);
      if (descriptors.length === 0) {
        fail("No face detected — center your face in the frame and try again.");
        return;
      }

      setStage("submitting");
      stopCamera();
      const res = await fetch("/api/college/attendance/face-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeddings: descriptors.map((d) => Array.from(d)) }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        fail(json.error ?? "Unable to register your face");
        return;
      }
      setStage("success");
      onSuccess();
    } catch (err) {
      console.error("[MarkAttendanceDialog] registration capture failed", err);
      fail("Unable to complete the request capturing your face. Try again.");
    }
  }

  async function handleCapture(video: HTMLVideoElement) {
    setStage("capturing");
    try {
      const frame = captureVideoFrame(video);
      const capturedDescriptor = await getFaceDescriptor(frame);
      if (!capturedDescriptor) {
        fail("No face detected — center your face in the frame and try again.");
        return;
      }

      capturedProofRef.current = { descriptor: Array.from(capturedDescriptor), capturedAt: Date.now() };
      setStage("verifying");
      // Fetched when the dialog opened; the server makes the real comparison again on submit.
      if (!samplesRef.current) loadSamples();
      const samples = await samplesRef.current;
      if (samples && samples.length === 0) {
        fail("You haven't registered your face yet. Register your face first.");
        return;
      }
      // Couldn't load them (network): let the server judge.
      const faceVerified = !samples || bestDistance(capturedDescriptor, samples) < FACE_MATCH_THRESHOLD;
      if (!faceVerified) {
        fail("Face didn't match your registered face. Try again with better lighting, facing the camera directly.");
        return;
      }

      stopCamera();
      // Usually in hand already (GPS started when the dialog opened); otherwise wait a little for a precise fix.
      if (!(await awaitLocation())) {
        fail(locationErrorRef.current ?? "Still waiting on your location — check location permissions and try again.");
        return;
      }

      // The face matched and the location is in hand, so the check-in is going
      // to stand - only now is there anything to explain. Asking up front made
      // people justify a check-in that might still have failed on face match or
      // location, and it sat in front of the camera for everyone whose clock
      // read late here but not on the server.
      // Lateness is judged NOW (after the scan), not when the dialog opened - someone
      // who crossed 09:05 during the scan is asked here instead of being refused by the
      // server and sent back to scan again.
      const lateNow = mode === "check-in" && isLateCheckIn(nowInIndia().timeHHMM, null, lateAfterRef.current);
      const hasReason = mode === "check-in" && !!lateReason.trim();
      // Reason given up front: check in straight away with it. Became late during the
      // scan with no reason yet: ask now, with this scan.
      if (lateNow && !hasReason) {
        setIsLate(true);
        setStage("late-reason");
        return;
      }

      await submitAttendance(lateNow || hasReason);
    } catch (err) {
      console.error("[MarkAttendanceDialog] capture failed", err);
      fail("Unable to complete the request verifying your face. Try again.");
    }
  }

  // The write itself - reached straight from handleCapture when nothing is
  // owed, or from the late-reason screen once the reason is filled in.
  async function submitAttendance(late: boolean) {
    if (!coordsRef.current) {
      fail("Still waiting on your location — check location permissions and try again.");
      return;
    }
    const proof = capturedProofRef.current;
    if (!proof) {
      fail("Unable to complete the request - try again.");
      return;
    }
    setStage("submitting");
    try {
      const res = await fetch(`/api/college/attendance/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: coordsRef.current.latitude,
          longitude: coordsRef.current.longitude,
          // The server compares this descriptor with the registered one itself and
          // judges freshness/precision; the match above is only this screen's early
          // feedback. (`distance` is no longer sent - the server's own figure is stored.)
          faceDescriptor: proof.descriptor,
          capturedAt: proof.capturedAt,
          accuracy: coordsRef.current.accuracy,
          ...(mode === "check-in" && late ? { lateReason: lateReason.trim() } : {}),
        }),
      });
      const json = await res.json() as { error?: string; code?: string; checkIn?: string; checkOut?: string };
      // The server's clock says late (this device's didn't): ask for the reason with the
      // scan already made (valid for 10 minutes) - never send them back to scan again.
      if (!res.ok && mode === "check-in" && json.code === "LATE_REASON_REQUIRED") {
        setIsLate(true);
        setStage("late-reason");
        return;
      }
      if (!res.ok) {
        fail(json.error ?? "Unable to mark attendance");
        return;
      }
      setResultTime(json.checkIn ?? json.checkOut ?? "");
      setStage("success");
      onSuccess();
    } catch (err) {
      console.error("[MarkAttendanceDialog] submit failed", err);
      fail("Unable to complete the request recording your attendance. Try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {isRegister
              ? "We'll guide you through a few quick actions to confirm it's really you, then securely store your facial features for future attendance check-ins."
              : "We'll guide you through a few quick actions, verify your face against your registered face, and confirm you're on campus."}
          </DialogDescription>
        </DialogHeader>

        {!isRegister && (stage === "init" || stage === "camera-ready") && campusLocation && userCoords && (() => {
          const geofence = checkCampusGeofence(userCoords.latitude, userCoords.longitude, campusLocation);
          return (
            <div className="space-y-2">
              <p className={`text-sm font-medium flex items-center gap-1.5 ${geofence.withinBounds ? "text-green-600" : "text-destructive"}`}>
                <MapPin className="h-4 w-4" />
                {geofence.withinBounds ? "You're within the campus boundary" : (geofence.message ?? "You appear to be outside the campus boundary")}
              </p>
              <CampusBoundaryMap campusLocation={campusLocation} userLocation={userCoords} className="h-40 w-full rounded-lg border" />
            </div>
          );
        })()}

        {mode === "check-in" && isLate && (stage === "late-reason" || stage === "reason-first") && (
          <div className="space-y-1.5">
            <Label htmlFor="late-reason" className="text-sm font-medium text-amber-700">
              You&rsquo;re checking in late — why?
            </Label>
            <Textarea
              id="late-reason"
              rows={2}
              placeholder="traffic, a personal errand, a delayed bus..."
              value={lateReason}
              onChange={(e) => setLateReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Your HOD and Principal will see this reason on the attendance report.</p>
          </div>
        )}

        <div className="space-y-4">
          {stage === "success" ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="font-medium">
                {isRegister ? "Face registered" : `${label} recorded at ${resultTime}`}
              </p>
            </div>
          ) : stage === "reason-first" ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <ScanFace className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">Add your reason, then scan your face</p>
              <p className="text-xs text-muted-foreground">Your check-in is recorded as soon as your face is verified.</p>
            </div>
          ) : stage === "late-reason" ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
              <p className="text-sm font-medium">Face verified &mdash; you&rsquo;re on campus</p>
              <p className="text-xs text-muted-foreground">Enter your reason above to complete check-in.</p>
            </div>
          ) : stage === "error" ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
            </div>
          ) : (
            <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover -scale-x-100" />
              {stage === "guided-liveness" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white text-sm text-center px-4">
                  {stepConfirmed ? (
                    <CheckCircle2 className="h-8 w-8 text-green-400" />
                  ) : (
                    <ScanFace className="h-6 w-6 animate-pulse" />
                  )}
                  <p className="text-xs uppercase tracking-wide text-white/70">
                    Step {stepIndex + 1} of {LIVENESS_STEPS.length}
                  </p>
                  <p className="font-medium">{stepConfirmed ? "Got it!" : LIVENESS_STEPS[stepIndex]}</p>
                  {!stepConfirmed && stepHint && (
                    <p className="text-xs bg-black/50 rounded px-2 py-1 mt-1">{stepHint}</p>
                  )}
                </div>
              )}
              {(stage === "init" || stage === "capturing" || stage === "verifying" || stage === "submitting") && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {stage === "init" && "Starting camera…"}
                  {stage === "capturing" && "Reading your face…"}
                  {stage === "verifying" && "Verifying…"}
                  {stage === "submitting" && "Submitting…"}
                </div>
              )}
              {!isRegister && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-xs text-white">
                  <MapPin className="h-3 w-3" /> Location required
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {stage === "error" && (
            <Button variant="outline" onClick={() => void startCamera()}>Try Again</Button>
          )}
          {stage === "camera-ready" && (
            <Button onClick={() => void handleStart()}>
              {isRegister ? <ScanFace className="h-4 w-4 mr-1.5" /> : <Camera className="h-4 w-4 mr-1.5" />}
              {isRegister ? "Start Registration" : `Start & ${label}`}
            </Button>
          )}
          {stage === "reason-first" && (
            <Button onClick={() => void startCamera()} disabled={!lateReason.trim()}>
              <Camera className="h-4 w-4 mr-1.5" />
              Continue to Face Scan
            </Button>
          )}
          {stage === "late-reason" && (
            <Button
              onClick={() => {
                // Only reachable after a capture; submitAttendance refuses to go on
                // without one, so nothing unverified can be recorded. No new scan:
                // this sends the verified one with the reason.
                void submitAttendance(true);
              }}
              disabled={!lateReason.trim()}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Submit & Check In
            </Button>
          )}
          {stage === "success" && (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CheckInSetup { method: "FACE" | "PASSKEY" | "EITHER"; phones: number }

/**
 * The attendance pages' dialog: the face scan or the phone unlock (passkey), by the college's Self Check-In
 * Method (Settings > Attendance Timings): FACE -> face; PASSKEY -> phone; EITHER -> phone when this person has
 * registered one (with "Use Face Scan Instead"), else face.
 */
export function MarkAttendanceDialog(props: MarkAttendanceDialogProps) {
  const [setup, setSetup] = useState<CheckInSetup | null>(null);
  const [forceFace, setForceFace] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/college/attendance/passkey")
      .then((r) => (r.ok ? r.json() : { method: "FACE", passkeys: [] }) as Promise<{ method?: CheckInSetup["method"]; passkeys?: unknown[] }>)
      .then((d) => { if (live) setSetup({ method: d.method ?? "FACE", phones: d.passkeys?.length ?? 0 }); })
      .catch(() => { if (live) setSetup({ method: "FACE", phones: 0 }); });
    return () => { live = false; };
  }, []);
  if (!setup) return null;
  const passkey = !forceFace && (
    setup.method === "PASSKEY"
    || (setup.method === "EITHER" && props.mode !== "register" && setup.phones > 0)
  );
  return passkey
    ? <PasskeyAttendanceDialog {...props} onUseFace={setup.method === "EITHER" ? () => setForceFace(true) : undefined} />
    : <FaceAttendanceDialog {...props} />;
}
