"use client";

import { Loader2 } from "lucide-react";
import { FileUpload } from "@/components/shared/FileUpload";
import { Avatar } from "@/components/shared/Avatar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useUpdateProfilePhoto } from "@/hooks/useProfilePhoto";

const ACCEPTED_TYPES = ["image/png", "image/jpeg"];
const MAX_SIZE_MB = 2;

interface ProfilePhotoUploadProps {
  name: string;
  photoUrl?: string;
  className?: string;
}

export function ProfilePhotoUpload({ name, photoUrl, className }: ProfilePhotoUploadProps) {
  const { toast } = useToast();
  const { mutate, isPending } = useUpdateProfilePhoto();

  const handleFileSelect = (file: File) => {
    // FileUpload only enforces size — MIME type still needs checking (drag & drop bypasses `accept`).
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ variant: "destructive", title: "Only PNG or JPEG images are allowed" });
      return;
    }

    mutate(file, {
      onSuccess: () => toast({ variant: "success", title: "Profile photo updated" }),
      onError: (err) => {
        toast({ variant: "destructive", title: err instanceof Error ? err.message : "Upload failed" });
      },
    });
  };

  return (
    <div className={cn("flex flex-col items-center gap-4 sm:flex-row sm:items-start", className)}>
      <div className="relative shrink-0">
        <Avatar name={name} photoUrl={photoUrl} size="lg" />
        {isPending && (
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-white animate-spin" />
          </div>
        )}
      </div>
      <FileUpload
        label="Upload Profile Photo"
        accept="image/png,image/jpeg"
        maxSizeMB={MAX_SIZE_MB}
        currentFileUrl={photoUrl}
        currentFileName={photoUrl ? "Current photo" : undefined}
        disabled={isPending}
        onFileSelect={handleFileSelect}
        className="w-full sm:max-w-sm"
      />
    </div>
  );
}
