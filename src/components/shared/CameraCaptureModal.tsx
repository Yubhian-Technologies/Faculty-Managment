"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, X, Check, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => Promise<void> | void;
  title?: string;
  description?: string;
}

export function CameraCaptureModal({
  isOpen,
  onClose,
  onCapture,
  title = "Capture Profile Photo",
  description = "Center the staff member's face in the frame and click capture.",
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Stop camera tracks cleanly
  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Start video stream
  const startCamera = async (mode: "user" | "environment") => {
    stopStream();
    setIsInitializing(true);
    setErrorMsg(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API is not supported in this browser environment.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 720 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsInitializing(false);
    } catch (err: unknown) {
      console.error("[CameraCaptureModal] startCamera error:", err);
      setIsInitializing(false);
      const message =
        err instanceof Error
          ? err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
            ? "Camera permission denied. Please allow camera access in your browser settings."
            : err.message
          : "Failed to access webcam.";
      setErrorMsg(message);
    }
  };

  // Lifecycle when open state changes
  useEffect(() => {
    if (isOpen) {
      setCapturedBlob(null);
      setCapturedPreview(null);
      setIsSaving(false);
      void startCamera(facingMode);
    } else {
      stopStream();
      if (capturedPreview) {
        URL.revokeObjectURL(capturedPreview);
        setCapturedPreview(null);
      }
    }

    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Switch facing mode (user vs environment)
  const toggleFacingMode = () => {
    const nextMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextMode);
    void startCamera(nextMode);
  };

  // Capture current frame from video to canvas
  const handleSnap = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;

    // Crop square center
    const size = Math.min(width, height);
    const startX = (width - size) / 2;
    const startY = (height - size) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // If front camera, mirror image for natural selfie orientation
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, startX, startY, size, size, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        const previewUrl = URL.createObjectURL(blob);
        setCapturedPreview(previewUrl);
        stopStream();
      },
      "image/jpeg",
      0.9
    );
  };

  // Retake photo
  const handleRetake = () => {
    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
      setCapturedPreview(null);
    }
    setCapturedBlob(null);
    void startCamera(facingMode);
  };

  // Confirm photo
  const handleConfirm = async () => {
    if (!capturedBlob) return;
    setIsSaving(true);
    try {
      const file = new File([capturedBlob], `staff_capture_${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      await onCapture(file);
      onClose();
    } catch (err) {
      console.error("[CameraCaptureModal] onCapture error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md p-5 bg-card border shadow-xl">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>

        {/* Viewfinder / Preview area */}
        <div className="relative aspect-square w-full max-w-[340px] mx-auto rounded-2xl overflow-hidden bg-black/90 border-2 border-border/80 shadow-inner flex items-center justify-center">
          {errorMsg ? (
            <div className="p-4 text-center space-y-2 text-destructive">
              <AlertCircle className="h-8 w-8 mx-auto" />
              <p className="text-xs font-semibold">{errorMsg}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startCamera(facingMode)}
                className="text-xs mt-2"
              >
                Retry Camera
              </Button>
            </div>
          ) : capturedPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={capturedPreview}
              alt="Captured staff preview"
              className="w-full h-full object-cover"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover ${
                  facingMode === "user" ? "scale-x-[-1]" : ""
                }`}
              />

              {/* Viewfinder Oval Guide */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-56 h-72 rounded-[48%] border-2 border-white/50 border-dashed shadow-2xl" />
              </div>

              {isInitializing && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-xs gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Starting camera...</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between pt-2 border-t">
          {capturedPreview ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetake}
                disabled={isSaving}
                className="text-xs"
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Retake
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirm}
                disabled={isSaving}
                className="text-xs font-semibold gap-1.5"
              >
                {isSaving ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                <span>{isSaving ? "Saving..." : "Use Photo"}</span>
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleFacingMode}
                disabled={isInitializing || !!errorMsg}
                className="text-xs text-muted-foreground gap-1"
                title="Switch Camera"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Flip</span>
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={handleSnap}
                disabled={isInitializing || !!errorMsg}
                className="rounded-full px-6 text-xs font-bold gap-1.5 shadow-md"
              >
                <Camera className="h-4 w-4" />
                <span>Capture</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="text-xs"
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
