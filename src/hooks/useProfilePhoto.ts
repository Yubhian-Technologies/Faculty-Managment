"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";

async function uploadProfilePhoto(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const uploadRes = await fetch("/api/upload/profile-photo", { method: "POST", body: fd });
  const uploadData = (await uploadRes.json()) as { url?: string; error?: string };
  if (!uploadRes.ok || !uploadData.url) throw new Error(uploadData.error ?? "Upload failed");

  const saveRes = await fetch("/api/college/users/me/photo", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoUrl: uploadData.url }),
  });
  const saveData = (await saveRes.json()) as { photoUrl?: string; error?: string };
  if (!saveRes.ok || !saveData.photoUrl) throw new Error(saveData.error ?? "Failed to save photo");

  return saveData.photoUrl;
}

async function deleteProfilePhoto(): Promise<void> {
  const res = await fetch("/api/college/users/me/photo", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoUrl: "" }),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to remove photo");
}

export function useUpdateProfilePhoto() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: uploadProfilePhoto,
    onSuccess: (photoUrl) => {
      if (user) setUser({ ...user, profilePhotoUrl: photoUrl });
      qc.invalidateQueries({ queryKey: ["collegeUser", user?.uid] });
    },
  });
}

export function useDeleteProfilePhoto() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: deleteProfilePhoto,
    onSuccess: () => {
      if (user) setUser({ ...user, profilePhotoUrl: undefined });
      qc.invalidateQueries({ queryKey: ["collegeUser", user?.uid] });
    },
  });
}
