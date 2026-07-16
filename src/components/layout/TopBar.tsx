"use client";

import { Menu, Bell } from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { CollegeSwitcher } from "@/components/layout/CollegeSwitcher";

interface TopBarProps {
  title?: string;
}

export function TopBar({ title }: TopBarProps) {
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
        {user && (
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold">
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    </header>
  );
}
