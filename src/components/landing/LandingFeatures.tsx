"use client";

import {
  BookOpenCheck,
  CalendarCheck,
  ClipboardList,
  MessageSquare,
  Award,
  Bell,
  ShieldCheck,
  LayoutDashboard,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Reveal } from "./Reveal";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  { icon: BookOpenCheck, title: "Academic Management", description: "Courses, timetables and academic records handled in one system." },
  { icon: CalendarCheck, title: "Attendance Management", description: "Accurate, real-time attendance tracking for every class." },
  { icon: ClipboardList, title: "Student Records", description: "A complete, organised record for every student's journey." },
  { icon: MessageSquare, title: "Communication", description: "Keep students, parents and faculty connected effortlessly." },
  { icon: Award, title: "Achievements", description: "Recognise and track academic and extracurricular milestones." },
  { icon: Bell, title: "Notifications", description: "Timely alerts so nothing important is ever missed." },
  { icon: ShieldCheck, title: "Secure Authentication", description: "Enterprise-grade sign-in keeps every account protected." },
  { icon: LayoutDashboard, title: "Role-Based Dashboards", description: "Every role sees exactly what's relevant to them." },
  { icon: Smartphone, title: "Responsive Design", description: "A polished experience on desktop, tablet and mobile alike." },
];

export function LandingFeatures() {
  return (
    <section id="features" className="bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Everything Your Institution Needs
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            A complete suite of tools, purpose-built for higher education.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <Reveal key={feature.title} delayMs={(i % 3) * 100}>
                <Card className="group h-full border-border/80 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <CardContent className="pt-6">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-foreground">{feature.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
