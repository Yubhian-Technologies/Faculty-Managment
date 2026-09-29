"use client";

import {
  Award,
  Briefcase,
  Building2,
  FlaskConical,
  PartyPopper,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { toast } from "@/hooks/useToast";

interface PermissionCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  items: string[];
}

// Static placeholder taxonomy - no backend yet. Every "Request" button below
// is intentionally a no-op toast; this page does not fetch, read, or write
// any data.
const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: "dept-events",
    label: "Department Events & Activities",
    icon: PartyPopper,
    items: ["Student events", "Training programs", "Workshops", "Webinars", "Guest lectures"],
  },
  {
    id: "certifications",
    label: "Certifications",
    icon: Award,
    items: ["NPTEL", "Global certifications", "Online certifications", "Professional certifications"],
  },
  {
    id: "external-participation",
    label: "External Participation",
    icon: Trophy,
    items: [
      "Hackathons",
      "Technical events",
      "Sports",
      "Cultural events",
      "Paper presentations",
      "Project competitions",
      "Conferences/symposiums",
    ],
  },
  {
    id: "counselling",
    label: "Counselling",
    icon: Users,
    items: ["Faculty allotment", "Counselling schedule", "Attendance", "Individual remarks", "Weekly consolidated remarks"],
  },
  {
    id: "internship-training",
    label: "Internship & Training",
    icon: Briefcase,
    items: ["Internships", "Industry training", "Summer internships", "External training programs"],
  },
  {
    id: "research-projects",
    label: "Research & Projects",
    icon: FlaskConical,
    items: [
      "Research activities",
      "Project participation",
      "Paper publication/presentation",
      "Patent activities",
      "External project work",
    ],
  },
  {
    id: "clubs-activities",
    label: "Clubs & Student Activities",
    icon: Sparkles,
    items: ["Club activities", "Student-organized events", "Inter-college activities", "Student societies"],
  },
  {
    id: "placement-career",
    label: "Placement & Career",
    icon: Building2,
    items: ["Placement drives", "Off-campus drives", "Interviews", "Career fairs", "Placement training"],
  },
];

function handleRequest() {
  toast({ title: "Coming soon", description: "This request type isn't live yet — check back soon" });
}

export default function StudentPermissionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Permission Management"
        description="Browse activity categories and raise a request. Nothing here is submitted yet."
      />

      <Card className="rounded-3xl border-border/60 bg-card/90 backdrop-blur-sm shadow-xs overflow-hidden">
        <CardContent className="p-4 sm:p-6">
          <Accordion type="multiple" className="w-full">
            {PERMISSION_CATEGORIES.map((category) => {
              const Icon = category.icon;
              return (
                <AccordionItem key={category.id} value={category.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 text-left">
                      <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-foreground">{category.label}</p>
                        <p className="text-xs text-muted-foreground">{category.items.length} request types</p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 pl-11">
                      {category.items.map((item) => (
                        <div
                          key={item}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5"
                        >
                          <span className="text-sm text-foreground">{item}</span>
                          <Button size="sm" variant="outline" onClick={handleRequest}>
                            Request
                          </Button>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
