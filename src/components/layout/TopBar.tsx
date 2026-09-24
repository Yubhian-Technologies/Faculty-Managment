"use client";

import Link from "next/link";
import { Menu, Bell } from "lucide-react";
import { getProfileHref } from "@/components/layout/navConfig";
import { TopBarSettingsMenu } from "@/components/layout/TopBarSettingsMenu";
import { useUIStore } from "@/store/uiStore";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { CollegeSwitcher } from "@/components/layout/CollegeSwitcher";

interface TopBarProps {
  title?: string;
  hiddenItems?: string[];
}

export function TopBar({ title, hiddenItems }: TopBarProps) {
  const { toggleSidebar, setNotificationDrawerOpen } = useUIStore();
  const { unreadCount } = useNotifications();
  const user = useAuthStore((s) => s.user);

  return (
    <header className="h-16 border-b bg-background flex items-center justify-between px-4 md:px-6 sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={toggleSidebar}
        >
          <Menu className="h-5 w-5" />
        </Button>
        {title && <h2 className="text-base font-semibold hidden sm:block">{title}</h2>}
      </div>

      <div className="flex items-center gap-2">
        <CollegeSwitcher />
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => setNotificationDrawerOpen(true)}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-primary rounded-full" />
          )}
        </Button>
        <TopBarSettingsMenu hiddenItems={hiddenItems} />
        {user && (() => {
          const avatar = (
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold overflow-hidden">
              {user.profilePhotoUrl ? (
                <img src={user.profilePhotoUrl} alt={user.name} className="h-full w-full object-cover" />
              ) : (
                user.name.charAt(0).toUpperCase()
              )}
            </div>
          );
          const profileHref = getProfileHref(user.role, user.realRole);
          return profileHref ? (
            <Link href={profileHref} title="My Profile" aria-label="My Profile" className="rounded-full hover:ring-2 hover:ring-primary/30 transition">
              {avatar}
            </Link>
          ) : avatar;
        })()}
      </div>
    </header>
  );
}
