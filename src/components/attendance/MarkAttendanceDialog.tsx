"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Eye, Loader2, MapPin, RotateCw, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CampusBoundaryMap } from "@/components/attendance/CampusBoundaryMap";
import {
  loadFaceModels, getFaceDescriptor, compareFaceDescriptors, loadImage,
  captureVideoFrame, waitForBlink, waitForHeadTurn, FACE_MATCH_THRESHOLD, type LivenessSample,
} from "@/lib/attendance/faceMatch";
import { checkCampusGeofence, type CampusLocation } from "@/lib/attendance/geofence";

// Surfaces the raw liveness numbers on screen. Blink detection needed two
// rounds of real-world tuning to get usable at all (see faceMatch.ts) and
// head-turn detection hasn't been tested against a real camera yet - keeping
// this visible from the start means the next report is diagnostic data, not
// another blind guess. Safe to flip off once both are confirmed reliable.
const SHOW_LIVENESS_DEBUG = true;

type Stage = "init" | "camera-ready" | "liveness-blink" | "liveness-turn" | "capturing" | "verifying" | "submitting" | "success" | "error";

interface MarkAttendanceDialogProps {
  mode: "check-in" | "check-out";
  profilePhotoUrl?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function MarkAttendanceDialog({ mode, profilePhotoUrl, open, onOpenChange, onSuccess }: MarkAttendanceDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stage, setStage] = useState<Stage>("init");
  const [errorMsg, setErrorMsg] = useState("");
  const [resultTime, setResultTime] = useState("");
  const coordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const cancelledRef = useRef(false);
  const [debug, setDebug] = useState<LivenessSample | null>(null);
  const [campusLocation, setCampusLocation] = useState<CampusLocation | null>(null);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const label = mode === "check-in" ? "Check In" : "Check Out";

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function fail(message: string) {
    setErrorMsg(message);
    setStage("error");
  }

  async function startCamera() {
    if (!profilePhotoUrl) {
      fail("You don't have a profile photo on file. Ask your HOD or Office to add one before marking attendance this way.");
      return;
    }
    if (!navigator.geolocation) {
      fail("Geolocation is not supported by this browser.");
      return;
    }
    setStage("init");
    setErrorMsg("");
    setUserCoords(null);

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
    if (open) {
      cancelledRef.current = false;
      void startCamera();
    } else {
      cancelledRef.current = true;
      stopCamera();
      setStage("init");
      setErrorMsg("");
      setResultTime("");
    }
    return () => { cancelledRef.current = true; stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleStart() {
    if (!videoRef.current) return;
    setDebug(null);
    try {
      setStage("liveness-blink");
      const blinked = await waitForBlink(videoRef.current, { shouldAbort: () => cancelledRef.current, onSample: setDebug });
      if (cancelledRef.current) return;
      if (!blinked) {
        fail("No blink detected — look at the camera and blink naturally, then try again.");
        return;
      }

      setDebug(null);
      setStage("liveness-turn");
      const turned = await waitForHeadTurn(videoRef.current, { shouldAbort: () => cancelledRef.current, onSample: setDebug });
      if (cancelledRef.current) return;
      if (!turned) {
        fail("No head movement detected — slowly turn your head to one side, then back to center, and try again.");
        return;
      }

      await handleCapture();
    } catch (err) {
      console.error("[MarkAttendanceDialog] liveness check failed", err);
      fail("Something went wrong verifying your face. Please try again.");
    }
  }

  async function handleCapture() {
    if (!videoRef.current) return;
    setStage("capturing");
    try {
      const frame = captureVideoFrame(videoRef.current);
      const capturedDescriptor = await getFaceDescriptor(frame);
      if (!capturedDescriptor) {
        fail("No face detected — center your face in the frame and try again.");
        return;
      }

      setStage("verifying");
      // Proxied through our own origin — Firebase Storage doesn't send
      // Access-Control-Allow-Origin, which would otherwise taint the canvas
      // face-api.js needs to read pixel data from.
      const refImg = await loadImage("/api/college/attendance/reference-photo");
      const refDescriptor = await getFaceDescriptor(refImg);
      if (!refDescriptor) {
        fail("Could not read a face from your profile photo. Ask your HOD or Office to update it.");
        return;
      }

      const distance = await compareFaceDescriptors(capturedDescriptor, refDescriptor);
      const faceVerified = distance < FACE_MATCH_THRESHOLD;
      if (!faceVerified) {
        fail("Face didn't match your profile photo. Try again with better lighting, facing the camera directly.");
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

  const isLiveness = stage === "liveness-blink" || stage === "liveness-turn";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            We&apos;ll ask you to blink and turn your head, verify your face against your profile photo, and confirm you&apos;re on campus.
          </DialogDescription>
        </DialogHeader>

        {(stage === "init" || stage === "camera-ready") && campusLocation && userCoords && (() => {
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
              <p className="font-medium">{label} recorded at {resultTime}</p>
            </div>
          ) : stage === "error" ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              {SHOW_LIVENESS_DEBUG && debug && (
                <p className="text-xs text-muted-foreground/70 font-mono mt-2">
                  {debug.baselineEar !== undefined && `baselineEar=${debug.baselineEar.toFixed(3)} `}
                  {debug.baselineYaw !== undefined && `baselineYaw=${debug.baselineYaw.toFixed(3)} `}
                  {debug.peakYawDelta !== undefined && `peakYawDelta=${debug.peakYawDelta.toFixed(3)} `}
                  ear={debug.ear?.toFixed(3) ?? "—"} yawOffset={debug.yawOffset?.toFixed(3) ?? "—"}
                </p>
              )}
            </div>
          ) : (
            <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover -scale-x-100" />
              {isLiveness && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white text-sm text-center px-4">
                  {stage === "liveness-blink" ? <Eye className="h-6 w-6 animate-pulse" /> : <RotateCw className="h-6 w-6 animate-pulse" />}
                  {debug?.step === "calibrating"
                    ? "Hold still, look at the camera…"
                    : stage === "liveness-blink"
                      ? "Now blink naturally…"
                      : "Now slowly turn your head to one side, then back to center…"}
                  {SHOW_LIVENESS_DEBUG && (
                    <p className="text-xs font-mono bg-black/50 rounded px-2 py-1 mt-1">
                      {stage === "liveness-blink"
                        ? <>ear={debug?.ear?.toFixed(3) ?? "—"} {debug?.baselineEar !== undefined && `base=${debug.baselineEar.toFixed(3)}`} {debug?.phase && `[${debug.phase}]`}</>
                        : <>yaw={debug?.yawOffset?.toFixed(3) ?? "—"} {debug?.baselineYaw !== undefined && `base=${debug.baselineYaw.toFixed(3)}`} {debug?.peakYawDelta !== undefined && `peak=${debug.peakYawDelta.toFixed(3)}`}</>
                      }
                    </p>
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
              <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-xs text-white">
                <MapPin className="h-3 w-3" /> Location required
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {stage === "error" && (
            <Button variant="outline" onClick={() => void startCamera()}>Try Again</Button>
          )}
          {stage === "camera-ready" && (
            <Button onClick={() => void handleStart()}>
              <Camera className="h-4 w-4 mr-1.5" /> Start & {label}
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
