"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { FileUpload } from "@/components/shared/FileUpload";
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
  className?: string;
}

// Uploads a photo to Storage for someone OTHER than the signed-in user (Principal
// editing a HOD/Vice Principal, HOD editing a faculty record). Unlike
// ProfilePhotoUpload, this does not persist the URL itself — the caller is an
// existing edit form that saves `profilePhotoUrl` together with its other fields.
export function AvatarUploadField({ name, photoUrl, targetId, onUploaded, className }: AvatarUploadFieldProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(photoUrl);

  const handleFileSelect = async (file: File) => {
    // FileUpload only enforces size — MIME type still needs checking (drag & drop bypasses `accept`).
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ variant: "destructive", title: "Only PNG or JPEG images are allowed" });
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
      setPreviewUrl(data.url);
      onUploaded(data.url);
      toast({ variant: "success", title: "Photo uploaded — save to apply" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn("flex flex-col items-center gap-4 sm:flex-row sm:items-start", className)}>
      <div className="relative shrink-0">
        <Avatar name={name} photoUrl={previewUrl} size="lg" />
        {uploading && (
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-white animate-spin" />
          </div>
        )}
      </div>
      <FileUpload
        label="Upload Photo"
        accept="image/png,image/jpeg"
        maxSizeMB={MAX_SIZE_MB}
        currentFileUrl={previewUrl}
        currentFileName={previewUrl ? "Current photo" : undefined}
        disabled={uploading}
        onFileSelect={(file) => void handleFileSelect(file)}
        className="w-full sm:max-w-sm"
      />
    </div>
  );
}
