"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  LayoutGrid,
  CalendarCheck,
  ClipboardCheck,
  Bell,
  TrendingUp,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function scrollToNextSection() {
  document.getElementById("stats")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Rotates through each word every 2.2s — the h1 always carries the full, current
// phrase as its accessible text (via the sr-only span below) so screen readers
// and SEO crawlers never see a truncated or stale headline.
const HEADLINE_WORDS = ["Connected", "Simplified", "Automated", "Productive", "Seamless"] as const;

function RotatingHeadline() {
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setWordIndex((prev) => (prev === HEADLINE_WORDS.length - 1 ? 0 : prev + 1));
    }, 2200);
    return () => clearTimeout(timeoutId);
  }, [wordIndex]);

  return (
    <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
      <span className="sr-only">{`One Platform. ${HEADLINE_WORDS[wordIndex]}.`}</span>
      <span aria-hidden="true">
        <span className="block">One Platform.</span>
        <span className="relative mt-1 grid justify-center overflow-hidden text-primary lg:justify-start">
          {HEADLINE_WORDS.map((word, i) => (
            <span
              key={word}
              className={cn(
                "[grid-area:1/1] whitespace-nowrap transition-all duration-500 ease-out motion-reduce:transition-none",
                i === wordIndex
                  ? "translate-y-0 opacity-100"
                  : i < wordIndex
                  ? "-translate-y-8 opacity-0"
                  : "translate-y-8 opacity-0"
              )}
            >
              {word}.
            </span>
          ))}
        </span>
      </span>
    </h1>
  );
}

/** The floating dashboard-card cluster, shared (at different sizes) between the
 *  large-screen absolute composition and the simplified tablet/mobile grid. */
function DashboardCards({ variant }: { variant: "floating" | "grid" }) {
  if (variant === "grid") {
    return (
      <div aria-hidden className="grid w-full grid-cols-2 gap-3">
        <Card className="col-span-2 border-border/80 p-4 shadow-md">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LayoutGrid className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Workflow Overview</p>
              <p className="text-xs text-muted-foreground">Every role, one platform</p>
            </div>
          </div>
          <div className="mt-3 flex items-end gap-1.5">
            {[40, 65, 50, 85, 60, 95].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-primary/70" style={{ height: `${h * 0.4}px` }} />
            ))}
          </div>
        </Card>
        <Card className="border-border/80 p-3 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-600">
            <CalendarCheck className="h-4 w-4" />
            <span className="text-xs font-semibold">Attendance</span>
          </div>
          <p className="mt-1 text-lg font-bold text-foreground">96%</p>
        </Card>
        <Card className="border-border/80 p-3 shadow-sm">
          <div className="flex items-center gap-2 text-primary">
            <ClipboardCheck className="h-4 w-4" />
            <span className="text-xs font-semibold">Leave Approval</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">2 pending review</p>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div
        aria-hidden
        className="landing-glow absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/25 blur-3xl"
      />

      <Card className="landing-float absolute left-1/2 top-1/2 w-72 -translate-x-1/2 -translate-y-1/2 border-border/80 p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LayoutGrid className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Workflow Overview</p>
            <p className="text-xs text-muted-foreground">Every role, one platform</p>
          </div>
        </div>
        <div className="mt-4 flex items-end gap-1.5">
          {[40, 65, 50, 85, 60, 95].map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-primary/70" style={{ height: `${h * 0.4}px` }} />
          ))}
        </div>
      </Card>

      <Card
        className="landing-float absolute -left-6 top-4 w-40 border-border/80 p-3.5 shadow-lg"
        style={{ animationDelay: "1s" }}
      >
        <div className="flex items-center gap-2 text-emerald-600">
          <CalendarCheck className="h-4 w-4" />
          <span className="text-xs font-semibold">Attendance</span>
        </div>
        <p className="mt-1 text-lg font-bold text-foreground">96%</p>
      </Card>

      <Card
        className="landing-float absolute -right-2 top-0 w-36 border-border/80 p-3 shadow-lg"
        style={{ animationDelay: "0.5s" }}
      >
        <div className="flex items-center gap-2 text-amber-600">
          <Bell className="h-4 w-4" />
          <span className="text-xs font-semibold">3 New</span>
        </div>
      </Card>

      <Card
        className="landing-float absolute -left-4 bottom-16 w-44 border-border/80 p-3.5 shadow-lg"
        style={{ animationDelay: "2s" }}
      >
        <div className="flex items-center gap-2 text-primary">
          <ClipboardCheck className="h-4 w-4" />
          <span className="text-xs font-semibold">Leave Approval</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">2 pending review</p>
      </Card>

      <Card
        className="landing-float absolute right-0 bottom-4 w-44 border-border/80 p-3.5 shadow-lg"
        style={{ animationDelay: "1.5s" }}
      >
        <div className="flex items-center gap-2 text-primary">
          <TrendingUp className="h-4 w-4" />
          <span className="text-xs font-semibold">Performance</span>
        </div>
        <p className="mt-1 text-lg font-bold text-foreground">Top 5%</p>
      </Card>

      <Card
        className="landing-float absolute bottom-0 left-1/2 w-48 -translate-x-1/2 border-border/80 p-3 shadow-lg"
        style={{ animationDelay: "2.5s" }}
      >
        <div className="flex items-center gap-2 text-indigo-600">
          <CalendarClock className="h-4 w-4" />
          <span className="text-xs font-semibold">Next Class</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">DBMS Lab · 10:00 AM</p>
      </Card>
    </>
  );
}

export function LandingHero() {
  return (
    <section
      id="home"
      className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-background to-indigo-100 pt-32 pb-24 sm:pt-40 sm:pb-32"
    >
      {/* Layered decorative background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="landing-grid-mesh absolute inset-0" />
        <div className="landing-blob absolute -left-24 top-10 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div
          className="landing-blob absolute -right-16 top-40 h-80 w-80 rounded-full bg-indigo-400/15 blur-3xl"
          style={{ animationDelay: "3s" }}
        />
        <div
          className="landing-blob absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-blue-300/10 blur-3xl"
          style={{ animationDelay: "6s" }}
        />
      </div>

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div className="landing-enter text-center lg:text-left">
          <RotatingHeadline />
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
            Streamline academics, administration, communication, approvals, and campus
            operations through one secure digital workspace built for students, faculty,
            parents, and administrators.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Button
              asChild
              size="lg"
              className="w-full transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] sm:w-auto"
            >
              <Link href="/login">
                Login
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="w-full transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] sm:w-auto"
            >
              <button type="button" onClick={scrollToNextSection}>
                Learn More
              </button>
            </Button>
          </div>
        </div>

        {/* Large screens: layered floating dashboard-card composition (decorative) */}
        <div
          aria-hidden
          className="landing-enter relative mx-auto hidden h-[460px] w-full max-w-lg lg:block"
          style={{ animationDelay: "150ms" }}
        >
          <DashboardCards variant="floating" />
        </div>

        {/* Tablet & mobile: simplified static preview so nothing crops or overflows */}
        <div
          aria-hidden
          className="landing-enter mx-auto w-full max-w-md sm:max-w-lg lg:hidden"
          style={{ animationDelay: "150ms" }}
        >
          <DashboardCards variant="grid" />
        </div>
      </div>
    </section>
  );
}
