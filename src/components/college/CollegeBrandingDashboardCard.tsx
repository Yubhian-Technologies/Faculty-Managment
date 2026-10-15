"use client";

import { useState, useRef, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import Link from "next/link";
import {
  Upload,
  Sparkles,
  CheckCircle2,
  RotateCcw,
  Loader2,
  Building2,
  ArrowRight,
  AlertCircle,
} from "lucide-react";

export function CollegeBrandingDashboardCard() {
  const { collegeInfo, loading } = useCollegeInfo();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);

  const activeLogo = collegeInfo?.logoUrl || "/vishnulogo.png";
  const hasCustomLogo = Boolean(collegeInfo?.hasCustomLogo);

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Unsupported file type",
        description: "Please select a PNG, JPEG, WEBP, or SVG image file.",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "Logo image must be smaller than 5 MB.",
      });
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleCancelUpload() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
  }

  async function handleConfirmUpload() {
    if (!selectedFile) return;
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/upload/college-logo", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to upload logo");
      }

      toast({
        variant: "success",
        title: "College Logo Updated",
        description: "Your custom college logo is now live across the platform.",
      });

      await queryClient.invalidateQueries({ queryKey: ["college-info"] });
      handleCancelUpload();
      setShowManageModal(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: message,
      });
    } finally {
      setIsUploading(false);
    }
  }

  async function handleResetToDefault() {
    setIsResetting(true);
    try {
      const res = await fetch("/api/college/info", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: "" }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to reset logo");
      }

      toast({
        title: "Logo Reset to Default",
        description: "Default Vishnu logo is now active across all timetables and official letterheads.",
      });

      await queryClient.invalidateQueries({ queryKey: ["college-info"] });
      setShowConfirmReset(false);
      setShowManageModal(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Reset failed";
      toast({
        variant: "destructive",
        title: "Reset Failed",
        description: message,
      });
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <>
      <Card className="border border-border/80 shadow-xs hover:shadow-md transition-shadow">
        <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row items-center sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0 w-full sm:w-auto">
            <div className="relative shrink-0 w-14 h-14 rounded-xl border border-border/70 bg-white dark:bg-zinc-900 p-1.5 flex items-center justify-center shadow-2xs">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <img
                  src={activeLogo}
                  alt={`${collegeInfo?.name || "College"} logo`}
                  className="max-w-full max-h-full object-contain"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-foreground truncate">
                  {collegeInfo?.name || "Institution Branding"}
                </span>
                {hasCustomLogo ? (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1 text-[10px] h-5 px-2 font-semibold">
                    <CheckCircle2 className="h-3 w-3" /> Custom Logo
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="border-amber-300 dark:border-amber-700/60 bg-amber-500/10 text-amber-800 dark:text-amber-300 gap-1 text-[10px] h-5 px-2 font-semibold">
                    <Sparkles className="h-3 w-3 text-amber-500" /> Default Vishnu Logo
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {hasCustomLogo
                  ? "Custom logo active on timetables and letterheads"
                  : "Using default Vishnu logo (click to add custom logo)"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs font-semibold"
              onClick={() => setShowManageModal(true)}
            >
              <Upload className="h-3.5 w-3.5 text-primary" />
              <span>{hasCustomLogo ? "Change Logo" : "Add Logo"}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              asChild
              className="gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Link href="/principal/settings">
                <span>Settings</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Manage Logo Dialog */}
      <Dialog open={showManageModal} onOpenChange={(open) => {
        if (!open) handleCancelUpload();
        setShowManageModal(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Manage College Logo
            </DialogTitle>
            <DialogDescription className="text-xs">
              Upload a custom institution logo or reset to the default Vishnu logo.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-4">
            <div className="flex flex-col items-center justify-center p-4 rounded-xl border bg-muted/20 gap-3">
              <div className="w-28 h-28 rounded-xl border-2 border-primary/20 bg-white dark:bg-zinc-900 p-2 flex items-center justify-center shadow-sm">
                <img
                  src={previewUrl || activeLogo}
                  alt="Logo"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-foreground">
                  {previewUrl
                    ? "New Selected Logo Preview"
                    : hasCustomLogo
                    ? "Active Custom College Logo"
                    : "Active Default Vishnu Logo"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Appears on all section timetables, faculty load tables & official PDFs
                </p>
              </div>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={handleFileSelect}
            />

            {previewUrl ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={handleCancelUpload}
                  disabled={isUploading}
                >
                  Cancel Selection
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1 text-xs gap-1.5"
                  onClick={handleConfirmUpload}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Save Logo</span>
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="w-full gap-2 text-xs font-semibold"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{hasCustomLogo ? "Upload Different Logo" : "Upload Custom Logo"}</span>
                </Button>

                {hasCustomLogo && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => setShowConfirmReset(true)}
                    disabled={isResetting}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset to Default Vishnu Logo</span>
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Reset Dialog */}
      <Dialog open={showConfirmReset} onOpenChange={setShowConfirmReset}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              Reset to Default Vishnu Logo?
            </DialogTitle>
            <DialogDescription className="text-xs pt-1">
              This will remove the current custom logo and revert to the default Vishnu logo on all timetables and letterheads.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowConfirmReset(false)}
              disabled={isResetting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleResetToDefault}
              disabled={isResetting}
              className="gap-2"
            >
              {isResetting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Resetting...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Confirm Reset</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
