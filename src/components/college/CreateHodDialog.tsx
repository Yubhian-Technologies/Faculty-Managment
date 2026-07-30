"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createUserSchema } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import type { z } from "zod";

const createHodSchema = createUserSchema.pick({ name: true, email: true, password: true });
type CreateHodFormData = z.infer<typeof createHodSchema>;

interface CreateHodDialogProps {
  department?: string;
  onCreated: (uid: string) => void;
}

export function CreateHodDialog({ department, onCreated }: CreateHodDialogProps) {
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateHodFormData>({
    resolver: zodResolver(createHodSchema),
  });

  const onSubmit = async (data: CreateHodFormData) => {
    try {
      const res = await fetch("/api/college/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, role: "HOD", department: department ?? "" }),
      });
      const json = await res.json() as { uid?: string; error?: string };

      if (res.status === 409) {
        toast({ variant: "destructive", title: "Email already in use", description: json.error });
        return;
      }
      if (!res.ok || !json.uid) {
        toast({ variant: "destructive", title: "Failed to create account", description: json.error });
        return;
      }

      toast({ variant: "success", title: "HOD account created", description: `${data.name} can now log in.` });
      reset();
      setOpen(false);
      onCreated(json.uid);
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Please try again." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">+ Create HOD</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create HOD Account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hod-name">Full Name *</Label>
            <Input id="hod-name" {...register("name")} placeholder="Dr. Ramesh Kumar" />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="hod-email">Email *</Label>
            <Input id="hod-email" type="email" {...register("email")} placeholder="hod@college.edu" />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="hod-password">Temporary Password *</Label>
            <Input id="hod-password" type="password" {...register("password")} placeholder="Min 8 characters" />
            {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            <p className="text-xs text-muted-foreground">Share this with the HOD to log in for the first time.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>Create HOD</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
