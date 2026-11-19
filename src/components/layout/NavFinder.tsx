"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { NavIcon } from "./NavIcon";
import type { NavGroup } from "./navGroups";
import { HUE_DOT, navHue } from "./navTheme";

// "Find a page": type part of a menu name and jump to it. Lists exactly the menu the sidebar shows (same groups,
// same labels), so it never offers a page the person can't open. `hotkey` = also open on Ctrl/Cmd + K (only one
// mounted copy should listen - the desktop sidebar).
export function NavFinder({
  groups,
  label,
  compact = false,
  hotkey = false,
  onNavigate,
}: {
  groups: NavGroup[];
  label: (href: string, fallback: string) => string;
  compact?: boolean;
  hotkey?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    // Read after mount so the server render and the first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  const go = (href: string) => {
    setOpen(false);
    onNavigate?.();
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={compact ? "Find a Page" : undefined}
        aria-label="Find a Page"
        className={cn(
          "flex items-center rounded-lg bg-white/[0.07] text-[#8fa0cc] hover:bg-white/[0.12] hover:text-white transition-colors shrink-0",
          compact ? "mx-auto h-10 w-10 justify-center" : "mx-3 h-9 gap-2 px-2.5 text-[13px]"
        )}
      >
        <Search className="h-4 w-4 shrink-0" />
        {!compact && (
          <>
            <span className="flex-1 text-left">Find a Page</span>
            {hotkey && <kbd className="rounded bg-white/10 px-1.5 py-px text-[11px] font-medium text-[#c9d3ee]">{isMac ? "⌘K" : "Ctrl K"}</kbd>}
          </>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 gap-0 overflow-hidden sm:max-w-lg">
          <DialogTitle className="sr-only">Find a Page</DialogTitle>
          <Command loop>
            <CommandInput placeholder="Type a page name..." />
            <CommandList className="max-h-[60vh]">
              <CommandEmpty>No page matches.</CommandEmpty>
              {groups.map((g, gi) => (
                <CommandGroup key={`${g.title ?? "top"}-${gi}`} heading={g.title ?? undefined}>
                  {g.items.map((item) => {
                    const name = label(item.href, item.label);
                    return (
                      <CommandItem key={item.href} value={`${name} ${g.title ?? ""} ${item.href}`} onSelect={() => go(item.href)} className="gap-2.5 py-2">
                        <span className={cn("h-2 w-2 rounded-sm shrink-0", HUE_DOT[navHue(g.title)])} />
                        <NavIcon name={item.iconName} className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{name}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
