"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Bell } from "lucide-react";
import { getProfileHref } from "@/components/layout/navConfig";
import { TopBarSettingsMenu } from "@/components/layout/TopBarSettingsMenu";
import { useUIStore } from "@/store/uiStore";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { CollegeSwitcher } from "@/components/layout/CollegeSwitcher";

import { VISHNU_LOGO_URL } from "@/lib/pdf/logo";

interface TopBarProps {
  title?: string;
  hiddenItems?: string[];
}

export function TopBar({ title, hiddenItems }: TopBarProps) {
  const { toggleSidebar, setNotificationDrawerOpen } = useUIStore();
  const { unreadCount } = useNotifications();
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();

  const isClassLeader = user?.role === "CLASS_LEADER" || pathname?.startsWith("/class-leader");

  return (
    <header className="h-16 border-b bg-background flex items-center justify-between px-4 md:px-6 sticky top-0 z-20">
      <div className="flex items-center gap-3">
        {isClassLeader ? (
          <Link href="/class-leader" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <img
              src={VISHNU_LOGO_URL}
              alt="Vishnu Logo"
              className="h-8 w-8 rounded-md object-contain shrink-0"
            />
            <div className="flex flex-col">
              <span className="text-sm font-bold leading-tight tracking-tight">Vishnu People</span>
              <span className="text-[10px] text-muted-foreground font-semibold leading-none">Class Leader</span>
            </div>
          </Link>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Toggle sidebar"
              onClick={toggleSidebar}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="md:hidden flex items-center gap-2">
              <img
                src={VISHNU_LOGO_URL}
                alt="Vishnu Logo"
                className="h-7 w-7 rounded-md object-contain shrink-0"
              />
            </div>
          </>
        )}
        {title && <h2 className="text-base font-semibold hidden sm:block">{title}</h2>}
      </div>

      <div className="flex items-center gap-2">
        <CollegeSwitcher />
        {!isClassLeader && (
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
        )}
        {!isClassLeader && user?.role !== "STUDENT" && <TopBarSettingsMenu hiddenItems={hiddenItems} />}
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
