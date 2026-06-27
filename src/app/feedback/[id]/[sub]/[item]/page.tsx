"use client";

import { use, useState } from "react";
import { Star, Send, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { Toaster } from "@/components/ui/toaster";

const CRITERIA: Record<string, { label: string; description: string }> = {
  clarity: {
    label: "Clarity of Explanation",
    description: "Did the candidate explain concepts in a simple, clear, and easy-to-understand way?",
  },
  engagement: {
    label: "Student Engagement",
    description: "Did the candidate interact with students, ask questions, and keep the class attentive?",
  },
  knowledgeDepth: {
    label: "Depth of Knowledge",
    description: "Did the candidate demonstrate strong subject knowledge and answer questions confidently?",
  },
  timeManagement: {
    label: "Time Management",
    description: "Did the candidate cover the topic well within the allotted time without rushing or going off-track?",
  },
  overallImpression: {
    label: "Overall Impression",
    description: "Overall, how effective was this candidate as a teacher based on this demo class?",
  },
};

function StarRating({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className={cn(
            "h-12 w-12 rounded-lg transition-colors flex items-center justify-center",
            (hovered || value) >= star ? "text-yellow-400 bg-yellow-50" : "text-muted-foreground bg-muted",
            !disabled && "hover:scale-110 active:scale-95 transition-transform cursor-pointer"
          )}
          aria-label={`${star} star`}
        >
          <Star className="h-6 w-6" fill={(hovered || value) >= star ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

// Route: /feedback/[collegeId]/[batchId]/[candidateId]  (params renamed to [id]/[sub]/[item] to resolve Next.js slug conflict)
export default function FeedbackPage({ params }: { params: Promise<{ id: string; sub: string; item: string }> }) {
  const { id: collegeId, sub: batchId, item: candidateId } = use(params);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comments, setComments] = useState("");
  const [ratings, setRatings] = useState({
    clarity: 0,
    engagement: 0,
    knowledgeDepth: 0,
    timeManagement: 0,
    overallImpression: 0,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const allRated = Object.values(ratings).every((v) => v > 0);
    if (!allRated) {
      toast({ variant: "destructive", title: "Rate all criteria", description: "Please rate all 5 criteria." });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/public/student-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId, batchId, candidateId, ratings, comments }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      toast({ variant: "destructive", title: "Submission failed", description: "Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
        <Toaster />
        <Card className="max-w-sm w-full text-center">
          <CardContent className="p-8 space-y-4">
            <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold">Thank You!</h2>
            <p className="text-muted-foreground">
              Your feedback has been submitted anonymously. It helps us make better hiring decisions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Toaster />
      <div className="max-w-lg mx-auto space-y-4 py-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">Demo Class Feedback</h1>
          <p className="text-muted-foreground text-sm">
            Rate the candidate&apos;s teaching demo. Your response is anonymous.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {Object.entries(CRITERIA).map(([key, { label, description }]) => (
            <Card key={key}>
              <CardContent className="p-4 space-y-3">
                <div>
                  <Label className="text-base font-medium">{label}</Label>
                  <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
                </div>
                <StarRating
                  value={ratings[key as keyof typeof ratings]}
                  onChange={(v) => setRatings((r) => ({ ...r, [key]: v }))}
                  disabled={isSubmitting}
                />
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardContent className="p-4 space-y-2">
              <Label htmlFor="comments">Additional Comments (optional)</Label>
              <Textarea
                id="comments"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Share any additional observations..."
                rows={3}
              />
            </CardContent>
          </Card>

          <div className="sticky bottom-4">
            <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
              <Send className="h-5 w-5 mr-2" />
              Submit Feedback
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
