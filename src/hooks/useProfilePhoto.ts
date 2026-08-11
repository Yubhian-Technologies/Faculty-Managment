"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";

const DEFAULT_PHOTO_ENDPOINT = "/api/college/users/me/photo";

async function uploadProfilePhoto(file: File, endpoint: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const uploadRes = await fetch("/api/upload/profile-photo", { method: "POST", body: fd });
  const uploadData = (await uploadRes.json()) as { url?: string; error?: string };
  if (!uploadRes.ok || !uploadData.url) throw new Error(uploadData.error ?? "Upload failed");

  const saveRes = await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoUrl: uploadData.url }),
  });
  const saveData = (await saveRes.json()) as { photoUrl?: string; error?: string };
  if (!saveRes.ok || !saveData.photoUrl) throw new Error(saveData.error ?? "Failed to save photo");

  return saveData.photoUrl;
}

async function deleteProfilePhoto(endpoint: string): Promise<void> {
  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoUrl: "" }),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to remove photo");
}

// endpoint defaults to the college-scoped route so every existing caller
// (Principal/VP/HOD/Panel/Tier-A roles) keeps working unchanged; GLOBAL/LOCATION-
// scoped "My Profile" pages pass their own /api/admin or /api/location endpoint.
export function useUpdateProfilePhoto(endpoint: string = DEFAULT_PHOTO_ENDPOINT) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: (file: File) => uploadProfilePhoto(file, endpoint),
    onSuccess: (photoUrl) => {
      if (user) setUser({ ...user, profilePhotoUrl: photoUrl });
      qc.invalidateQueries({ queryKey: ["collegeUser", user?.uid] });
    },
  });
}

export function useDeleteProfilePhoto(endpoint: string = DEFAULT_PHOTO_ENDPOINT) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: () => deleteProfilePhoto(endpoint),
    onSuccess: () => {
      if (user) setUser({ ...user, profilePhotoUrl: undefined });
      qc.invalidateQueries({ queryKey: ["collegeUser", user?.uid] });
    },
  });
}
