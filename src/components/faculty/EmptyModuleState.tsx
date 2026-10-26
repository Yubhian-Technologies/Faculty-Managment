import Link from "next/link";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyModuleMessage } from "@/lib/faculty/moduleEmpty";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";

// What a faculty details tab shows when nothing has been entered in it yet: a clear sentence and, for someone who
// may edit the tab, an Edit button. `editHref` is passed only by a page that also shows its own Edit button, so
// this can never offer an edit the page itself would not.
export function EmptyModuleState({ moduleKey, editHref }: { moduleKey: ProfileModuleKey; editHref?: string }) {
  const def = PROFILE_MODULES[moduleKey];
  const message = emptyModuleMessage(def.emptyNoun, !!editHref);
  const Icon = def.icon;
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center"
      data-testid="empty-module-state"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-medium text-foreground">{message.title}</p>
        <p className="text-sm text-muted-foreground">{message.hint}</p>
      </div>
      {editHref && (
        <Button asChild>
          <Link href={editHref}><Pencil className="mr-2 h-4 w-4" />Edit</Link>
        </Button>
      )}
    </div>
  );
}
