"use client";

import { useState, useRef, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import {
  Upload,
  Sparkles,
  CheckCircle2,
  RotateCcw,
  Loader2,
  Building2,
  Image as ImageIcon,
  AlertCircle,
} from "lucide-react";

export function CollegeLogoSettingsCard({ className = "" }: { className?: string }) {
  const { collegeInfo, loading } = useCollegeInfo();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

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
    setShowUploadModal(true);
    // Reset input so same file can be picked again if desired
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleCancelUpload() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    setShowUploadModal(false);
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
        description: "Your custom college logo is now active across all timetables and reports.",
      });

      await queryClient.invalidateQueries({ queryKey: ["college-info"] });
      handleCancelUpload();
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
      <Card className={`overflow-hidden border shadow-xs ${className}`}>
        <CardHeader className="bg-muted/30 pb-4 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                College Logo & Letterhead Branding
              </CardTitle>
              <CardDescription className="mt-1">
                Configure your college logo for official timetables, attendance exports, and printable letterheads.
              </CardDescription>
            </div>
            <div>
              {hasCustomLogo ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1.5 shadow-2xs font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Custom Logo Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="border-amber-300 dark:border-amber-700/60 bg-amber-500/10 text-amber-800 dark:text-amber-300 gap-1.5 font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  Default Vishnu Logo
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
            {/* Visual Logo Frame with transparency checkered background */}
            <div className="relative group shrink-0">
              <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl border-2 border-border/80 bg-white dark:bg-zinc-900/90 shadow-sm p-2.5 flex items-center justify-center overflow-hidden transition-all duration-200 group-hover:border-primary/50">
                {/* Checkered pattern background for clear transparent PNG visibility */}
                <div
                  className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
                  style={{
                    backgroundImage:
                      "linear-gradient(45deg, #000 25%, transparent 25%), linear-gradient(-45deg, #000 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #000 75%), linear-gradient(-45deg, transparent 75%, #000 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                  }}
                />
                {loading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                ) : (
                  <img
                    src={activeLogo}
                    alt={`${collegeInfo?.name || "College"} logo`}
                    className="max-w-full max-h-full object-contain relative z-10 transition-transform duration-200 group-hover:scale-105"
                  />
                )}
              </div>
            </div>

            {/* Details & Actions */}
            <div className="flex-1 space-y-3 text-center md:text-left min-w-0">
              <div>
                <h4 className="text-sm font-semibold text-foreground truncate">
                  {collegeInfo?.name || "College Identity"}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {hasCustomLogo
                    ? "Custom institution logo is uploaded and will appear on all institutional letterheads."
                    : "No custom logo added yet. The system automatically defaults to the Vishnu logo across all modules."}
                </p>
              </div>

              <div className="rounded-lg bg-muted/40 border border-border/60 p-3 text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
                  <span>Recommendation & Guidelines</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Recommended: High-resolution PNG or SVG with transparent background (square or circular, max 5 MB).
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleFileSelect}
                />

                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="gap-2 text-xs font-semibold shadow-xs"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || isUploading}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{hasCustomLogo ? "Change Logo" : "Add Custom Logo"}</span>
                </Button>

                {hasCustomLogo && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-2 text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40"
                    onClick={() => setShowConfirmReset(true)}
                    disabled={loading || isResetting}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset to Default Vishnu Logo</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload Preview & Confirmation Modal */}
      <Dialog open={showUploadModal} onOpenChange={(open) => !open && handleCancelUpload()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              Preview & Confirm Logo
            </DialogTitle>
            <DialogDescription className="text-xs">
              Review your new college logo before applying it to all official letterheads and timetables.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="flex items-center justify-center p-6 rounded-xl border bg-muted/20">
              <div className="w-32 h-32 rounded-xl border-2 border-primary/20 bg-white dark:bg-zinc-900 p-2 flex items-center justify-center shadow-inner">
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Logo preview"
                    className="max-w-full max-h-full object-contain"
                  />
                )}
              </div>
            </div>

            {selectedFile && (
              <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Filename:</span>
                  <span className="font-semibold text-foreground truncate max-w-[200px]">
                    {selectedFile.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">File Size:</span>
                  <span className="font-medium text-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCancelUpload}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmUpload}
              disabled={isUploading}
              className="gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Uploading & Saving...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Set as College Logo</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Confirmation Dialog */}
      <Dialog open={showConfirmReset} onOpenChange={setShowConfirmReset}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              Reset to Default Vishnu Logo?
            </DialogTitle>
            <DialogDescription className="text-xs pt-1">
              This will remove the current custom logo and revert the institution branding back to the default Vishnu logo on all timetables, student attendance exports, and letterheads.
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
              Keep Custom Logo
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
                  <span>Reset to Default Logo</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
