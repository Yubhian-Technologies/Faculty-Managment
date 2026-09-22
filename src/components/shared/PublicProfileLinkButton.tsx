"use client";

import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useMyEmployeeId } from "@/hooks/useMyEmployeeId";

// Shared "My Profile" page action for HOD/Principal/Vice-Principal/Faculty -
// copies the no-auth public profile link (see /faculty-public/[param]) for
// this login's own record. Hidden until an employeeId is known, same as the
// Faculty page's original behavior.
export function PublicProfileLinkButton() {
  const employeeId = useMyEmployeeId();
  if (!employeeId) return null;

  function copyPublicProfileLink() {
    void navigator.clipboard.writeText(`${window.location.origin}/faculty-public/facultyid=${encodeURIComponent(employeeId!)}`);
    toast({ variant: "success", title: "Public profile link copied" });
  }

  return (
    <Button variant="outline" onClick={copyPublicProfileLink}>
      <Share2 className="h-4 w-4 mr-2" />Copy Public Profile Link
    </Button>
  );
}
