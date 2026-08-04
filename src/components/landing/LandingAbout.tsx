"use client";

import {
  GraduationCap,
  Users,
  Award,
  Globe,
  BookOpen,
  Trophy,
  HeartHandshake,
  Rocket,
  Quote,
  ArrowUpRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";

/** Placeholder campus photo — swap for an official Vishnu campus shot when one
 *  is available. Loaded as a plain <img> to match the navbar/footer logo usage. */
const ABOUT_IMAGE_URL =
  "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=1200&q=80";

const HIGHLIGHTS = [
  { icon: GraduationCap, value: "25K+", label: "Students", tile: "bg-blue-50 text-blue-600" },
  { icon: Users, value: "3K+", label: "Faculty", tile: "bg-emerald-50 text-emerald-600" },
  { icon: Award, value: "15K+", label: "Alumni", tile: "bg-amber-50 text-amber-600" },
  { icon: Globe, value: "100+", label: "Events", tile: "bg-purple-50 text-purple-600" },
] as const;

/** Each pillar keeps its own hue from the existing palette. Tailwind needs whole
 *  class names at build time, so the per-card variants are spelled out rather
 *  than composed from a colour token. */
const PILLARS = [
  {
    icon: BookOpen,
    title: "Knowledge",
    description: "Encouraging lifelong learning and knowledge sharing.",
    tile: "bg-blue-50 text-blue-600",
    accentBar: "bg-blue-600",
    accentHover: "group-hover:bg-blue-600 group-hover:border-blue-600",
  },
  {
    icon: Users,
    title: "Collaboration",
    description: "Connecting minds to create meaningful impact.",
    tile: "bg-emerald-50 text-emerald-600",
    accentBar: "bg-emerald-600",
    accentHover: "group-hover:bg-emerald-600 group-hover:border-emerald-600",
  },
  {
    icon: Trophy,
    title: "Excellence",
    description: "Striving for the highest standards in everything we do.",
    tile: "bg-amber-50 text-amber-600",
    accentBar: "bg-amber-600",
    accentHover: "group-hover:bg-amber-600 group-hover:border-amber-600",
  },
  {
    icon: HeartHandshake,
    title: "Inclusivity",
    description: "A community that welcomes, respects, and uplifts all.",
    tile: "bg-purple-50 text-purple-600",
    accentBar: "bg-purple-600",
    accentHover: "group-hover:bg-purple-600 group-hover:border-purple-600",
  },
  {
    icon: Rocket,
    title: "Innovation",
    description: "Inspiring new ideas and building for the future.",
    tile: "bg-rose-50 text-rose-600",
    accentBar: "bg-rose-600",
    accentHover: "group-hover:bg-rose-600 group-hover:border-rose-600",
  },
] as const;

export function LandingAbout() {
  return (
    <section id="about">
      {/* ── Intro: copy + highlights on the left, campus photo & pull-quote right ── */}
      <div className="relative overflow-hidden bg-linear-to-b from-muted/50 via-background to-background py-20 sm:py-24">
        {/* Dotted texture echoing the mock's top-right corner detail */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-10 hidden h-48 w-56 text-border lg:block"
          style={{
            backgroundImage: "radial-gradient(currentColor 1.5px, transparent 1.5px)",
            backgroundSize: "16px 16px",
            maskImage: "linear-gradient(to left, black, transparent)",
            WebkitMaskImage: "linear-gradient(to left, black, transparent)",
          }}
        />

        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
          <Reveal>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
              About Vishnu People
            </span>

            <h2 className="mt-6 text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              Building a Community that{" "}
              <span className="text-primary">Inspires, Innovates</span> and{" "}
              <span className="text-primary">Impact Lives</span>
            </h2>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Vishnu People is more than a platform — it&apos;s a thriving community where
              students, faculty, alumni, and professionals come together to share knowledge,
              celebrate achievements, and create opportunities for everyone.
            </p>

            <dl className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
              {HIGHLIGHTS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex items-center gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.tile}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <dt className="sr-only">{item.label}</dt>
                      <dd>
                        <span className="block text-lg font-bold text-foreground">
                          {item.value}
                        </span>
                        <span className="block text-sm text-muted-foreground">{item.label}</span>
                      </dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          </Reveal>

          <Reveal delayMs={120}>
            <div className="relative">
              <img
                src={ABOUT_IMAGE_URL}
                alt="Students walking together on the Vishnu campus"
                loading="lazy"
                className="h-72 w-full rounded-2xl object-cover shadow-xl sm:h-96 lg:h-104"
              />

              {/* Pull-quote: stacked under the photo on small screens, overlapping
                  the photo's right edge from lg up as in the reference. */}
              <Card className="mt-5 border-border/80 p-6 shadow-xl lg:absolute lg:-right-6 lg:top-1/2 lg:mt-0 lg:w-72 lg:-translate-y-1/2">
                <Quote className="h-7 w-7 text-primary" aria-hidden />
                <blockquote className="mt-3 space-y-1 text-base font-medium leading-relaxed text-foreground">
                  <p>Together, we learn.</p>
                  <p>Together, we grow.</p>
                  <p>Together, we build a better tomorrow.</p>
                </blockquote>
                <div className="mt-5 h-0.5 w-10 rounded-full bg-primary" />
                <p className="mt-3 text-sm font-semibold text-primary">Vishnu People</p>
              </Card>
            </div>
          </Reveal>
        </div>
      </div>

      {/* ── Our Pillars ────────────────────────────────────────────────────────── */}
      <div className="py-16 sm:py-20">
        <div className="mx-auto max-w-352 px-3 sm:px-5 lg:px-6">
          {/* Rounded light-blue panel the whole block sits on; white cards read against it. */}
          <div className="relative overflow-hidden rounded-4xl bg-blue-50 px-5 py-20 sm:rounded-[2.5rem] sm:px-10 sm:py-24 lg:px-16 lg:py-28">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/60"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full bg-white/40"
            />

            <Reveal className="relative mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Our Pillars
              </h2>
              <p className="mt-3 text-base text-muted-foreground sm:text-lg">
                The values that drive our community forward.
              </p>
            </Reveal>

            <div className="relative mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {PILLARS.map((pillar, i) => {
              const Icon = pillar.icon;
              return (
                <Reveal key={pillar.title} delayMs={i * 80} className="h-full">
                  <Card
                    className={cn(
                      "group relative flex h-full flex-col overflow-hidden border-border/80 p-6 shadow-sm",
                      "transition-all duration-300 ease-out hover:-translate-y-2 hover:shadow-xl",
                      "motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-14 w-14 items-center justify-center rounded-2xl",
                        "transition-transform duration-300 group-hover:scale-110 motion-reduce:transform-none",
                        pillar.tile
                      )}
                    >
                      <Icon className="h-6 w-6" />
                    </div>

                    <h3 className="mt-6 text-lg font-bold text-foreground">{pillar.title}</h3>
                    <p className="mt-2 mb-8 text-sm leading-relaxed text-muted-foreground">
                      {pillar.description}
                    </p>

                    {/* Arrow sits flush to the card bottom regardless of copy length,
                        and fills with the pillar's colour on hover. */}
                    <div
                      className={cn(
                        "mt-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-transparent",
                        "text-muted-foreground transition-all duration-300 group-hover:text-white",
                        "motion-reduce:transition-none",
                        pillar.accentHover
                      )}
                    >
                      <ArrowUpRight className="h-5 w-5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none" />
                    </div>

                    {/* Accent bar wipes across the card's bottom edge on hover. */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0",
                        "transition-transform duration-500 ease-out group-hover:scale-x-100",
                        "motion-reduce:transition-none",
                        pillar.accentBar
                      )}
                    />
                  </Card>
                </Reveal>
              );
            })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
