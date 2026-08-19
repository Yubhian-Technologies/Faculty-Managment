"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, MapPin, ScanFace, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CampusBoundaryMap } from "@/components/attendance/CampusBoundaryMap";
import {
  loadFaceModels, getFaceDescriptor, compareFaceDescriptors, captureVideoFrame,
  calibrateFaceBaseline, waitForGuidedBlink, waitForGuidedTurn, waitForGuidedRecenter,
  FACE_MATCH_THRESHOLD,
} from "@/lib/attendance/faceMatch";
import { checkCampusGeofence, type CampusLocation } from "@/lib/attendance/geofence";

// Same 3-step guided liveness sequence for both Register and Check-in/out —
// one instruction on screen at a time, in this order. "Tilt" accepts a head
// turn to either side (see waitForGuidedTurn call below): camera mirroring
// varies by device, so which physical direction reads as "left" on screen
// isn't reliable to assert without real-hardware testing — what matters here
// is that a deliberate head movement away from center happened at all.
const LIVENESS_STEPS = ["Blink your eyes", "Tilt your head to the left", "Look straight at the camera"];

// Deliberately slow: an instruction stays up at least this long even if the
// action is detected almost instantly, so there's time to read and react to
// it — and after detection, a short "Got it" confirmation holds before the
// next instruction appears, rather than jumping straight to it.
const STEP_MIN_DISPLAY_MS = 1500;
const STEP_CONFIRM_HOLD_MS = 1300;

type Stage = "init" | "camera-ready" | "guided-liveness" | "capturing" | "verifying" | "submitting" | "success" | "error";

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

export function MarkAttendanceDialog({ mode, open, onOpenChange, onSuccess }: MarkAttendanceDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stage, setStage] = useState<Stage>("init");
  const [errorMsg, setErrorMsg] = useState("");
  const [resultTime, setResultTime] = useState("");
  const coordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const cancelledRef = useRef(false);
  const [campusLocation, setCampusLocation] = useState<CampusLocation | null>(null);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepHint, setStepHint] = useState<string | null>(null);
  const [stepConfirmed, setStepConfirmed] = useState(false);

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

  async function startCamera() {
    // Defensive: guards against ever running two live getUserMedia streams
    // at once (e.g. a caller invoking this again before the previous one
    // was released) - stopCamera() is a no-op if nothing's running.
    stopCamera();
    setStage("init");
    setErrorMsg("");
    setUserCoords(null);

    if (!isRegister) {
      if (!navigator.geolocation) {
        fail("Geolocation is not supported by this browser.");
        return;
      }
      fetch("/api/college/attendance/campus-location")
        .then((r) => r.json() as Promise<{ campusLocation: CampusLocation | null }>)
        .then((d) => setCampusLocation(d.campusLocation))
        .catch(() => { /* non-critical - the map is a heads-up, not the actual check */ });

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          coordsRef.current = coords;
          setUserCoords(coords);
        },
        () => { fail("Failed to get your location. Check location permissions and try again."); },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    }

    try {
      await loadFaceModels();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStage("camera-ready");
    } catch {
      fail("Could not access your camera. Check camera permissions and try again.");
    }
  }

  useEffect(() => {
    void (async () => {
      if (open) {
        cancelledRef.current = false;
        await startCamera();
      } else {
        cancelledRef.current = true;
        stopCamera();
        setStage("init");
        setErrorMsg("");
        setResultTime("");
      }
    })();
    return () => { cancelledRef.current = true; stopCamera(); };
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

  // Shared 3-step guided liveness check (blink → tilt → re-center) used by
  // both Register and Check-in/out. Returns true once all 3 steps are
  // confirmed; on failure it has already called fail() with a message.
  async function runGuidedLiveness(video: HTMLVideoElement): Promise<boolean> {
    const abortCheck = () => cancelledRef.current;
    try {
      setStepHint(null);
      setStepConfirmed(false);

      const baseline = await calibrateFaceBaseline(video, { shouldAbort: abortCheck });
      if (cancelledRef.current) return false;
      if (!baseline) {
        fail("Couldn't get a clear view of your face. Please try again.");
        return false;
      }

      setStepIndex(0);
      const blinkOk = await runLivenessStep(() =>
        waitForGuidedBlink(video, baseline.ear, { shouldAbort: abortCheck, onHint: setStepHint })
      );
      if (cancelledRef.current) return false;
      if (!blinkOk) {
        fail("No blink detected. Please try again.");
        return false;
      }

      setStepIndex(1);
      const tiltOk = await runLivenessStep(async () =>
        (await waitForGuidedTurn(video, baseline.yawOffset, { shouldAbort: abortCheck, onHint: setStepHint })) !== null
      );
      if (cancelledRef.current) return false;
      if (!tiltOk) {
        fail("No head movement detected. Please try again.");
        return false;
      }

      setStepIndex(2);
      const centerOk = await runLivenessStep(() =>
        waitForGuidedRecenter(video, baseline.yawOffset, { shouldAbort: abortCheck, onHint: setStepHint })
      );
      if (cancelledRef.current) return false;
      if (!centerOk) {
        fail("Please try again.");
        return false;
      }

      return true;
    } catch (err) {
      console.error("[MarkAttendanceDialog] guided liveness failed", err);
      fail("Something went wrong verifying your face. Please try again.");
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
      const frame = captureVideoFrame(video);
      const descriptor = await getFaceDescriptor(frame);
      if (!descriptor) {
        fail("No face detected — center your face in the frame and try again.");
        return;
      }

      setStage("submitting");
      stopCamera();
      const res = await fetch("/api/college/attendance/face-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedding: Array.from(descriptor) }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        fail(json.error ?? "Failed to register your face");
        return;
      }
      setStage("success");
      onSuccess();
    } catch (err) {
      console.error("[MarkAttendanceDialog] registration capture failed", err);
      fail("Something went wrong capturing your face. Please try again.");
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

      setStage("verifying");
      const regRes = await fetch("/api/college/attendance/face-registration");
      const regJson = await regRes.json() as { registered?: boolean; embedding?: number[] | null };
      if (!regJson.registered || !regJson.embedding) {
        fail("You haven't registered your face yet. Please register your face first.");
        return;
      }
      const refDescriptor = new Float32Array(regJson.embedding);

      const distance = await compareFaceDescriptors(capturedDescriptor, refDescriptor);
      const faceVerified = distance < FACE_MATCH_THRESHOLD;
      if (!faceVerified) {
        fail("Face didn't match your registered face. Try again with better lighting, facing the camera directly.");
        return;
      }

      if (!coordsRef.current) {
        // Give the geolocation call a moment if it hasn't resolved yet.
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!coordsRef.current) {
        fail("Still waiting on your location — check location permissions and try again.");
        return;
      }

      setStage("submitting");
      stopCamera();
      const res = await fetch(`/api/college/attendance/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: coordsRef.current.latitude,
          longitude: coordsRef.current.longitude,
          faceMatchDistance: distance,
          faceVerified: true,
        }),
      });
      const json = await res.json() as { error?: string; checkIn?: string; checkOut?: string };
      if (!res.ok) {
        fail(json.error ?? "Failed to mark attendance");
        return;
      }
      setResultTime(json.checkIn ?? json.checkOut ?? "");
      setStage("success");
      onSuccess();
    } catch (err) {
      console.error("[MarkAttendanceDialog] capture failed", err);
      fail("Something went wrong verifying your face. Please try again.");
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

        <div className="space-y-4">
          {stage === "success" ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="font-medium">
                {isRegister ? "Face registered successfully" : `${label} recorded at ${resultTime}`}
              </p>
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
          {stage === "success" && (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
