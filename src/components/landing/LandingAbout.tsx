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
} from "lucide-react";
import { Card } from "@/components/ui/card";
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

const PILLARS = [
  {
    icon: BookOpen,
    title: "Knowledge",
    description: "Encouraging lifelong learning and knowledge sharing.",
    tile: "bg-blue-50 text-blue-600",
  },
  {
    icon: Users,
    title: "Collaboration",
    description: "Connecting minds to create meaningful impact.",
    tile: "bg-emerald-50 text-emerald-600",
  },
  {
    icon: Trophy,
    title: "Excellence",
    description: "Striving for the highest standards in everything we do.",
    tile: "bg-amber-50 text-amber-600",
  },
  {
    icon: HeartHandshake,
    title: "Inclusivity",
    description: "A community that welcomes, respects, and uplifts all.",
    tile: "bg-purple-50 text-purple-600",
  },
  {
    icon: Rocket,
    title: "Innovation",
    description: "Inspiring new ideas and building for the future.",
    tile: "bg-rose-50 text-rose-600",
  },
] as const;

export function LandingAbout() {
  return (
    <section id="about">
      {/* ── Intro: copy + highlights on the left, campus photo & pull-quote right ── */}
      <div className="relative overflow-hidden bg-gradient-to-b from-muted/50 via-background to-background py-20 sm:py-24">
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
                className="h-72 w-full rounded-2xl object-cover shadow-xl sm:h-96 lg:h-[26rem]"
              />

              {/* Pull-quote: stacked under the photo on small screens, overlapping
                  the photo's right edge from lg up as in the reference. */}
              <Card className="mt-5 border-border/80 p-6 shadow-xl lg:absolute lg:right-[-1.5rem] lg:top-1/2 lg:mt-0 lg:w-72 lg:-translate-y-1/2">
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
      <div className="py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Our Pillars
            </h2>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              The values that drive our community forward.
            </p>
          </Reveal>

          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {PILLARS.map((pillar, i) => {
              const Icon = pillar.icon;
              return (
                <Reveal key={pillar.title} delayMs={i * 80}>
                  <Card className="h-full border-border/80 p-6 text-center shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg">
                    <div
                      className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${pillar.tile}`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mt-5 text-base font-semibold text-foreground">
                      {pillar.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {pillar.description}
                    </p>
                  </Card>
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
