"use client";

import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Star, Send, CheckCircle } from "lucide-react";
import { studentFeedbackSchema, type StudentFeedbackFormData } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { Toaster } from "@/components/ui/toaster";

const RATING_LABELS: Record<string, string> = {
  clarity: "Clarity of Explanation",
  engagement: "Student Engagement",
  knowledgeDepth: "Depth of Knowledge",
  timeManagement: "Time Management",
  overallImpression: "Overall Impression",
};

function StarRating({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
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
            (hovered || value) >= star
              ? "text-yellow-400 bg-yellow-50"
              : "text-muted-foreground bg-muted",
            !disabled && "hover:scale-110 active:scale-95 transition-transform cursor-pointer"
          )}
          aria-label={`${star} star`}
        >
          <Star
            className="h-6 w-6"
            fill={(hovered || value) >= star ? "currentColor" : "none"}
          />
        </button>
      ))}
    </div>
  );
}

// Route: /feedback/[batchId]/[candidateId]  (params renamed to [id]/[sub] to resolve Next.js slug conflict)
export default function FeedbackPage({ params }: { params: Promise<{ id: string; sub: string }> }) {
  const { id: batchId, sub: candidateId } = use(params);
  const [submitted, setSubmitted] = useState(false);
  const [ratings, setRatings] = useState({
    clarity: 0,
    engagement: 0,
    knowledgeDepth: 0,
    timeManagement: 0,
    overallImpression: 0,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StudentFeedbackFormData>({
    resolver: zodResolver(studentFeedbackSchema),
    defaultValues: { ratings },
  });

  const onSubmit = async (data: StudentFeedbackFormData) => {
    const allRated = Object.values(ratings).every((v) => v > 0);
    if (!allRated) {
      toast({ variant: "destructive", title: "Rate all criteria", description: "Please rate all 5 criteria." });
      return;
    }

    try {
      const res = await fetch("/api/public/student-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, candidateId, ratings, comments: data.comments }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      toast({ variant: "destructive", title: "Submission failed", description: "Please try again." });
    }
  };

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
              Your feedback has been submitted anonymously. It will help us make better hiring decisions.
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

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {Object.entries(RATING_LABELS).map(([key, label]) => (
            <Card key={key}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Label className="text-base font-medium">{label}</Label>
                  <StarRating
                    value={ratings[key as keyof typeof ratings]}
                    onChange={(v) => setRatings((r) => ({ ...r, [key]: v }))}
                    disabled={isSubmitting}
                  />
                </div>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardContent className="p-4 space-y-2">
              <Label htmlFor="comments">Additional Comments (optional)</Label>
              <Textarea
                id="comments"
                {...register("comments")}
                placeholder="Share any additional observations..."
                rows={3}
              />
              {errors.comments && <p className="text-sm text-destructive">{errors.comments.message}</p>}
            </CardContent>
          </Card>

          <div className="sticky bottom-4">
            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={isSubmitting}
            >
              <Send className="h-5 w-5 mr-2" />
              Submit Feedback
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
