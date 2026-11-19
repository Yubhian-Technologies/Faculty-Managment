"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { isNavItemActive, type NavItem } from "./navConfig";
import { NavIcon } from "./NavIcon";
import type { NavGroup } from "./navGroups";
import { HUE_DOT, HUE_ICON, NAV_ACTIVE, NAV_IDLE, navHue } from "./navTheme";

const FOLDED_KEY = "fms-nav-folded";

// Sections the person folded shut, kept in this browser (a convenience: storage may be blocked, never throw).
function readFolded(): Set<string> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(FOLDED_KEY) : null;
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveFolded(folded: Set<string>) {
  try { window.localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded])); } catch { /* not kept */ }
}

/**
 * The menu list of the navy sidebar and the phone drawer: colored sections (navTheme), foldable, the open page
 * highlighted. `collapsed` = the desktop icon rail (every section open, names as tooltips). `badge` adds a count /
 * dot to an item; `onNavigate` runs on every click (the drawer closes itself).
 */
export function NavMenu({
  groups,
  navItems,
  pathname,
  label,
  collapsed = false,
  roomy = false,
  badge,
  onNavigate,
}: {
  groups: NavGroup[];
  navItems: NavItem[];
  pathname: string;
  label: (href: string, fallback: string) => string;
  collapsed?: boolean;
  /** Taller rows for touch (phone drawer). */
  roomy?: boolean;
  badge?: (item: NavItem, collapsed: boolean) => ReactNode;
  onNavigate?: () => void;
}) {
  const [folded, setFolded] = useState<Set<string>>(readFolded);
  const toggle = (title: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      saveFolded(next);
      return next;
    });

  return (
    <>
      {groups.map((group, gi) => {
        const hue = navHue(group.title);
        const hasActive = group.items.some((item) => isNavItemActive(item, pathname, navItems));
        // A folded section still shows its open page; on the icon rail every section is open.
        const open = collapsed || !group.title || !folded.has(group.title) || hasActive;
        return (
          <div key={`${group.title ?? "top"}-${gi}`} className={cn(gi > 0 && (collapsed ? "mt-2 pt-2 border-t border-white/10" : "mt-2"))}>
            {group.title && !collapsed && (
              <button
                type="button"
                onClick={() => toggle(group.title as string)}
                aria-expanded={open}
                className="group/sec w-full flex items-center gap-2 px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-[#7d8dba] hover:text-white transition-colors"
              >
                <span className={cn("h-2 w-2 rounded-[3px] shrink-0", HUE_DOT[hue])} />
                <span className="truncate flex-1 text-left">{group.title}</span>
                {!open && <span className="rounded-md bg-white/10 px-1.5 text-[10.5px] font-medium text-[#c9d3ee]">{group.items.length}</span>}
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-all duration-200", open ? "opacity-0 group-hover/sec:opacity-100" : "-rotate-90")} />
              </button>
            )}
            <div className={cn("grid transition-[grid-template-rows] duration-200 ease-in-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <div className="overflow-hidden">
                <div className="space-y-0.5 py-0.5">
                  {group.items.map((item) => {
                    const isActive = isNavItemActive(item, pathname, navItems);
                    const name = label(item.href, item.label);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        title={collapsed ? name : undefined}
                        aria-label={collapsed ? name : undefined}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "relative flex items-center rounded-lg text-[13.5px] font-medium transition-colors duration-150",
                          collapsed ? "justify-center h-10 w-full" : cn("gap-2.5 px-2.5", roomy ? "h-11" : "h-9"),
                          isActive ? NAV_ACTIVE : NAV_IDLE
                        )}
                      >
                        <NavIcon name={item.iconName} className={cn("shrink-0", roomy ? "h-[18px] w-[18px]" : "h-4 w-4", isActive ? "text-white" : HUE_ICON[hue])} />
                        {!collapsed && <span className="truncate">{name}</span>}
                        {badge?.(item, collapsed)}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
