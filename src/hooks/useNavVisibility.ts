import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

export function useNavVisibility() {
  const user = useAuthStore((s) => s.user);
  const [hiddenModules, setHiddenModules] = useState<string[]>([]);
  const [hiddenItems, setHiddenItems] = useState<string[]>([]);

  useEffect(() => {
    if (!user?.collegeId) return;
    fetch("/api/college/settings/nav-visibility")
      .then((r) => r.json() as Promise<{ hiddenModules: string[]; hiddenItems: string[] }>)
      .then((d) => {
        setHiddenModules(d.hiddenModules ?? []);
        setHiddenItems(d.hiddenItems ?? []);
      })
      .catch(() => {});
  }, [user?.collegeId, user?.role]);

  return { hiddenModules, hiddenItems };
}
