"use client";

import {
  CheckCircle2,
  LayoutDashboard,
  ShieldCheck,
  Zap,
  Cloud,
  Smartphone,
  UserCog,
  Navigation,
  Database,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Reveal } from "./Reveal";

const CHECKLIST = [
  { icon: LayoutDashboard, label: "Modern Interface" },
  { icon: ShieldCheck, label: "Secure Platform" },
  { icon: Zap, label: "Fast Performance" },
  { icon: Cloud, label: "Cloud Based" },
  { icon: Smartphone, label: "Mobile Friendly" },
  { icon: UserCog, label: "Role-Based Access" },
  { icon: Navigation, label: "Easy Navigation" },
  { icon: Database, label: "Centralized Information" },
];

const TILE_ICONS = [ShieldCheck, LayoutDashboard, Cloud, Smartphone, Zap, UserCog];

export function LandingWhyUs() {
  return (
    <section id="about" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">About</h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
            Vishnu People represents the spirit, achievements, and collective journey of a
            vibrant community built on knowledge, innovation, and excellence. It brings together
            students, faculty members, alumni, researchers, professionals, and leaders who
            contribute to creating a strong ecosystem of learning, collaboration, and growth.
          </p>
        </Reveal>
      </div>

      <div className="mx-auto mt-16 grid max-w-7xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <Reveal>
          <div className="relative rounded-3xl bg-gradient-to-br from-primary/10 via-blue-50 to-indigo-100 p-8 sm:p-10">
            <div className="grid grid-cols-3 gap-4">
              {TILE_ICONS.map((Icon, i) => (
                <div
                  key={i}
                  className="landing-float flex aspect-square items-center justify-center rounded-2xl border border-white/60 bg-white/70 shadow-sm backdrop-blur-sm"
                  style={{ animationDelay: `${i * 0.4}s` }}
                >
                  <Icon className="h-7 w-7 text-primary" />
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <div>
          <Reveal>
            <h3 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              What Makes Vishnu People Unique
            </h3>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              Vishnu People stands apart through its strong sense of belonging, collaboration,
              and continuous pursuit of excellence.
            </p>
          </Reveal>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CHECKLIST.map((item, i) => {
              const Icon = item.icon;
              return (
                <Reveal key={item.label} delayMs={i * 60}>
                  <Card className="flex items-center gap-3 border-border/80 p-3.5 shadow-sm">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-medium text-foreground">{item.label}</span>
                    <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-500" />
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
