"use client";

import { GraduationCap, Users, Building2, Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useRevealOnScroll } from "./useRevealOnScroll";
import { useCountUp } from "./useCountUp";

const STATS = [
  { icon: GraduationCap, value: 5000, suffix: "+", label: "Students" },
  { icon: Users, value: 300, suffix: "+", label: "Faculty" },
  { icon: Building2, value: 25, suffix: "+", label: "Departments" },
  { icon: Layers, value: 50, suffix: "+", label: "Services" },
] as const;

function StatCard({ stat, active }: { stat: (typeof STATS)[number]; active: boolean }) {
  const Icon = stat.icon;
  const value = useCountUp(stat.value, active);

  return (
    <Card className="group border-border/80 p-6 text-center shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <p className="mt-4 text-3xl font-bold text-foreground sm:text-4xl">
        {value.toLocaleString("en-IN")}
        {stat.suffix}
      </p>
      <p className="mt-1 text-sm font-medium text-muted-foreground">{stat.label}</p>
    </Card>
  );
}

export function LandingStats() {
  const { ref, isVisible } = useRevealOnScroll<HTMLDivElement>();

  return (
    <section id="stats" className="border-y border-border/60 bg-muted/30 py-16 sm:py-20">
      <div
        ref={ref}
        className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 sm:gap-6 sm:px-6 lg:grid-cols-4 lg:px-8"
      >
        {STATS.map((stat) => (
          <StatCard key={stat.label} stat={stat} active={isVisible} />
        ))}
      </div>
    </section>
  );
}
