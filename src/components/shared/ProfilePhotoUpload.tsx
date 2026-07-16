"use client";

import { useRef } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Avatar } from "@/components/shared/Avatar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useUpdateProfilePhoto, useDeleteProfilePhoto } from "@/hooks/useProfilePhoto";

const ACCEPTED_TYPES = ["image/png", "image/jpeg"];
const MAX_SIZE_MB = 2;

interface ProfilePhotoUploadProps {
  name: string;
  photoUrl?: string;
  className?: string;
}

export function ProfilePhotoUpload({ name, photoUrl, className }: ProfilePhotoUploadProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutate: upload, isPending: uploading } = useUpdateProfilePhoto();
  const { mutate: remove, isPending: deleting } = useDeleteProfilePhoto();
  const busy = uploading || deleting;

  const handleFileSelect = (file: File) => {
    // FileUpload only enforces size — MIME type still needs checking (drag & drop bypasses `accept`).
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ variant: "destructive", title: "Only PNG or JPEG images are allowed" });
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast({ variant: "destructive", title: `Image must be under ${MAX_SIZE_MB}MB` });
      return;
    }

    upload(file, {
      onSuccess: () => toast({ variant: "success", title: "Profile photo updated" }),
      onError: (err) => {
        toast({ variant: "destructive", title: err instanceof Error ? err.message : "Upload failed" });
      },
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    e.target.value = "";
  };

  const handleDelete = () => {
    remove(undefined, {
      onSuccess: () => toast({ variant: "success", title: "Profile photo removed" }),
      onError: (err) => {
        toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to remove photo" });
      },
    });
  };

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => !busy && inputRef.current?.click()}
        disabled={busy}
        className="relative rounded-full disabled:opacity-70"
        aria-label={photoUrl ? "Change profile photo" : "Upload profile photo"}
      >
        <Avatar name={name} photoUrl={photoUrl} size="lg" />
        {!photoUrl && !busy && (
          <span className="absolute bottom-0 right-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center ring-2 ring-background">
            <Camera className="h-3.5 w-3.5" />
          </span>
        )}
        {busy && (
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
        disabled={busy}
      />
      {photoUrl && (
        <div className="flex items-center gap-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="text-primary hover:underline disabled:opacity-70"
          >
            Change
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="text-destructive hover:underline disabled:opacity-70"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
