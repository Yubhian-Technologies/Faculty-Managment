"use client";

import { Quote, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Reveal } from "./Reveal";

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  audience: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "Checking my timetable, attendance and results used to mean three different logins. Now it's all in one place, and it's actually easy to use.",
    name: "Ananya Reddy",
    role: "B.Tech, 3rd Year",
    audience: "Student",
  },
  {
    quote:
      "Marking attendance and updating marks for an entire section takes minutes now instead of a full afternoon of paperwork.",
    name: "Dr. K. Srinivas",
    role: "Associate Professor, CSE",
    audience: "Faculty",
  },
  {
    quote:
      "I can see my daughter's attendance and fee status without calling the office. It gives real peace of mind.",
    name: "Lakshmi Prasad",
    role: "Parent",
    audience: "Parent",
  },
];

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function LandingTestimonials() {
  return (
    <section id="testimonials" className="bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            What Our Community Says
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Trusted by the students, faculty and families of Vishnu institutions.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.name} delayMs={i * 120} className="h-full">
              <Card className="flex h-full flex-col border-border/80 p-6 shadow-sm transition-shadow duration-300 hover:shadow-lg">
                <Quote className="h-7 w-7 text-primary/30" aria-hidden />
                <CardContent className="flex-1 px-0 pb-0 pt-3">
                  <div className="flex gap-0.5" aria-label="5 out of 5 stars">
                    {Array.from({ length: 5 }).map((_, starIdx) => (
                      <Star key={starIdx} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-foreground/90">&ldquo;{t.quote}&rdquo;</p>
                </CardContent>
                <div className="mt-5 flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {initials(t.name)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.role} · {t.audience}
                    </p>
                  </div>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
