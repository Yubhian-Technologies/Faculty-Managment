"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Avatar } from "@/components/shared/Avatar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

const ACCEPTED_TYPES = ["image/png", "image/jpeg"];
const MAX_SIZE_MB = 2;

interface AvatarUploadFieldProps {
  name: string;
  photoUrl?: string;
  /** uid or facultyId this photo belongs to — used to name the Storage object. */
  targetId: string;
  onUploaded: (url: string) => void;
  /** Shown as a "Delete" action next to "Change" once a photo exists. */
  onDeleted?: () => void;
  className?: string;
}

// Uploads a photo to Storage for someone OTHER than the signed-in user (Principal
// editing a HOD/Vice Principal, HOD editing a faculty record). Unlike
// ProfilePhotoUpload, this does not persist the URL itself — the caller is an
// existing edit form that saves `profilePhotoUrl` together with its other fields.
export function AvatarUploadField({ name, photoUrl, targetId, onUploaded, onDeleted, className }: AvatarUploadFieldProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = async (file: File) => {
    // FileUpload only enforces size — MIME type still needs checking (drag & drop bypasses `accept`).
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ variant: "destructive", title: "Only PNG or JPEG images are allowed" });
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast({ variant: "destructive", title: `Image must be under ${MAX_SIZE_MB}MB` });
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("targetId", targetId);
      const res = await fetch("/api/upload/profile-photo", { method: "POST", body: fd });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
      onUploaded(data.url);
      toast({ variant: "success", title: "Photo uploaded" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFileSelect(file);
    e.target.value = "";
  };

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => !uploading && inputRef.current?.click()}
        disabled={uploading}
        className="relative rounded-full disabled:opacity-70"
        aria-label={photoUrl ? "Change photo" : "Upload photo"}
      >
        <Avatar name={name} photoUrl={photoUrl} size="lg" />
        {!photoUrl && !uploading && (
          <span className="absolute bottom-0 right-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center ring-2 ring-background">
            <Camera className="h-3.5 w-3.5" />
          </span>
        )}
        {uploading && (
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
            <Loader2 className="h-5 w-5 text-white animate-spin" />
          </div>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={handleChange}
        className="sr-only"
        disabled={uploading}
      />
      {photoUrl && (
        <div className="flex items-center gap-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-primary hover:underline disabled:opacity-70"
          >
            Change
          </button>
          {onDeleted && (
            <button
              type="button"
              onClick={onDeleted}
              disabled={uploading}
              className="text-destructive hover:underline disabled:opacity-70"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
