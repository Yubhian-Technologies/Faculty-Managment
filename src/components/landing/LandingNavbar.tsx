"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LOGIN_URL, NAV_SECTIONS, VISHNU_LOGO_URL } from "./constants";

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>("home");

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 24);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    const elements = NAV_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  function handleNavClick(id: string) {
    setMobileOpen(false);
    scrollToSection(id);
  }

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-background/95 backdrop-blur-md border-b border-border shadow-sm"
          : "bg-transparent border-b border-transparent"
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Primary">
        <button
          type="button"
          onClick={() => handleNavClick("home")}
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <img src={VISHNU_LOGO_URL} alt="Vishnu People logo" className="h-9 w-9 object-contain" />
          <span className="text-lg font-bold text-foreground">Vishnu People</span>
        </button>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => handleNavClick(section.id)}
              aria-current={activeId === section.id ? "true" : undefined}
              className={cn(
                "relative rounded-md px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                activeId === section.id
                  ? "text-primary"
                  : "text-foreground/80 hover:text-foreground"
              )}
            >
              {section.label}
              {activeId === section.id && (
                <span className="absolute inset-x-3 -bottom-[1px] h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>

        <div className="hidden md:block">
          <Button asChild>
            <Link href={LOGIN_URL}>Login</Link>
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      <div
        className={cn(
          "overflow-hidden border-b border-border bg-background/95 backdrop-blur-md transition-[max-height] duration-300 md:hidden",
          mobileOpen ? "max-h-96" : "max-h-0 border-b-0"
        )}
      >
        <div className="flex flex-col gap-1 px-4 pb-4 pt-2">
          {NAV_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => handleNavClick(section.id)}
              className={cn(
                "rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors",
                activeId === section.id
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/80 hover:bg-accent hover:text-foreground"
              )}
            >
              {section.label}
            </button>
          ))}
          <Button asChild className="mt-2">
            <Link href={LOGIN_URL}>Login</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
