"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings, Settings2, KeyRound, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { CollegeAdminAccountMenu } from "@/components/layout/CollegeAdminAccountMenu";
import { getSettingsHref } from "@/components/layout/navConfig";
import { useAuthStore } from "@/store/authStore";

const ITEM_CLASS =
  "flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md text-left hover:bg-muted transition-colors";

// The gear next to the notification bell: the role's Settings page (when it has
// one) plus Change Password, in one place instead of a sidebar entry and a
// separate icon beside Log out. A College Admin has no personal login to change
// a password for, so it gets its Account settings dialog (name, phone,
// password) here instead.
export function TopBarSettingsMenu({ hiddenItems = [] }: { hiddenItems?: string[] }) {
  const user = useAuthStore((s) => s.user);
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  if (!user) return null;

  const isCollegeAdmin = user.realRole === "COLLEGE_ADMIN";
  const settingsHref = getSettingsHref(user.role, user.roles ?? user.seatRoles ?? []);
  const showSettings = !!settingsHref && !hiddenItems.includes(settingsHref);

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" title="Settings" aria-label="Settings">
            <Settings className="h-5 w-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1">
          {showSettings && (
            <Link href={settingsHref} onClick={() => setMenuOpen(false)} className={ITEM_CLASS}>
              <Settings2 className="h-4 w-4" />
              Settings
            </Link>
          )}
          {isCollegeAdmin ? (
            <button
              type="button"
              className={ITEM_CLASS}
              onClick={() => { setMenuOpen(false); setAccountOpen(true); }}
            >
              <UserCog className="h-4 w-4" />
              Account &amp; password
            </button>
          ) : (
            <button
              type="button"
              className={ITEM_CLASS}
              onClick={() => { setMenuOpen(false); setPasswordOpen(true); }}
            >
              <KeyRound className="h-4 w-4" />
              Change password
            </button>
          )}
        </PopoverContent>
      </Popover>

      {isCollegeAdmin ? (
        <CollegeAdminAccountMenu
          uid={user.uid}
          name={user.name}
          phone={user.phone}
          open={accountOpen}
          onOpenChange={setAccountOpen}
        />
      ) : (
        <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      )}
    </>
  );
}
