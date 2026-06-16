"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCap, Briefcase, MapPin, Send, Loader2 } from "lucide-react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, db } from "@/lib/firebase/client";
import { getDoc, doc, getDocs, collection, query, where } from "firebase/firestore";
import { createCandidate } from "@/lib/firestore/hiring";
import { publicApplicationSchema, type PublicApplicationFormData } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "@/hooks/useToast";
import { Toaster } from "@/components/ui/toaster";
import type { College, VacancyRequest } from "@/types";
import { Timestamp } from "firebase/firestore";

interface Props {
  collegeId: string;
}

export function CareersPageClient({ collegeId }: Props) {
  const [college, setCollege] = useState<College | null>(null);
  const [openings, setOpenings] = useState<VacancyRequest[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedVacancy, setSelectedVacancy] = useState<VacancyRequest | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const collegeSnap = await getDoc(doc(db, "colleges", collegeId));
        if (!collegeSnap.exists()) { setNotFound(true); return; }
        setCollege({ id: collegeSnap.id, ...collegeSnap.data() } as College);

        const q = query(
          collection(db, "colleges", collegeId, "vacancyRequests"),
          where("status", "==", "APPROVED")
        );
        const snap = await getDocs(q);
        setOpenings(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VacancyRequest));
      } catch {
        setNotFound(true);
      } finally {
        setDataLoading(false);
      }
    }
    load();
  }, [collegeId]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PublicApplicationFormData>({
    resolver: zodResolver(publicApplicationSchema),
  });

  const onSubmit = async (data: PublicApplicationFormData) => {
    if (!selectedVacancy) {
      toast({ variant: "destructive", title: "Select a position", description: "Choose a position to apply for." });
      return;
    }
    if (!resume) {
      toast({ variant: "destructive", title: "Resume required", description: "Please upload your resume." });
      return;
    }

    try {
      const resumeRef = ref(storage, `colleges/${collegeId}/resumes/${Date.now()}_${resume.name}`);
      await uploadBytes(resumeRef, resume);
      const resumeUrl = await getDownloadURL(resumeRef);

      await createCandidate(collegeId, {
        name: data.name,
        email: data.email,
        phone: data.phone,
        department: selectedVacancy.department,
        position: selectedVacancy.position,
        resumeUrl,
        source: "CAREERS_PAGE",
        currentStage: "DEMO",
        status: "PENDING",
        isShortlisted: false,
        hasArrived: false,
        vacancyId: selectedVacancy.id,
        collegeId,
      });

      setSubmitted(true);
      reset();
    } catch {
      toast({ variant: "destructive", title: "Submission failed", description: "Please try again." });
    }
  };

  if (dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-center">
        <div>
          <h1 className="text-2xl font-bold mb-2">Institution not found</h1>
          <p className="text-muted-foreground">The careers page you are looking for does not exist.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Toaster />
        <Card className="max-w-md w-full text-center">
          <CardContent className="p-8 space-y-4">
            <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <Send className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold">Application Submitted!</h2>
            <p className="text-muted-foreground">
              Thank you for applying to <strong>{college?.name}</strong>. We will review your application and get in touch soon.
            </p>
            <Button onClick={() => setSubmitted(false)} variant="outline">Apply for Another Position</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <Toaster />
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm sm:text-base">{college?.name}</h1>
            <p className="text-xs text-muted-foreground">Faculty Careers</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div className="text-center space-y-2 py-6">
          <h2 className="text-3xl font-bold">Join Our Faculty</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Shape the future of education. We are looking for passionate educators to join {college?.name}.
          </p>
        </div>

        <div>
          <h3 className="text-xl font-semibold mb-4">Open Positions</h3>
          {openings.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No open positions at the moment. Check back soon.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {openings.map((v) => (
                <Card
                  key={v.id}
                  onClick={() => setSelectedVacancy(v)}
                  className={`cursor-pointer transition-all ${selectedVacancy?.id === v.id ? "border-primary ring-2 ring-primary/20" : "hover:shadow-md"}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Briefcase className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-semibold">{v.position}</h4>
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />{v.department}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {v.requiredCount} opening{v.requiredCount > 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {selectedVacancy && (
          <Card>
            <CardHeader>
              <CardTitle>Apply for: {selectedVacancy.position}</CardTitle>
              <p className="text-sm text-muted-foreground">{selectedVacancy.department}</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name *</Label>
                    <Input id="name" {...register("name")} placeholder="Dr. Jane Smith" />
                    {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input id="email" type="email" {...register("email")} placeholder="jane@example.com" />
                    {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="phone">Mobile Number *</Label>
                    <Input id="phone" type="tel" {...register("phone")} placeholder="9876543210" maxLength={10} />
                    {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Resume / CV *</Label>
                  <FileUpload onFileSelect={setResume} accept=".pdf,.doc,.docx" maxSizeMB={5} label="Upload Resume (PDF, DOC)" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="coverLetter">Cover Letter (optional)</Label>
                  <Textarea id="coverLetter" {...register("coverLetter")} placeholder="Tell us why you are the right fit..." rows={4} />
                </div>

                <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
                  <Send className="h-4 w-4 mr-2" />Submit Application
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
