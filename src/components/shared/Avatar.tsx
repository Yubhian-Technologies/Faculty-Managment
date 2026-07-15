import { getInitials, cn } from "@/lib/utils";

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-24 w-24 text-2xl",
} as const;

interface AvatarProps {
  name: string;
  photoUrl?: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

export function Avatar({ name, photoUrl, size = "md", className }: AvatarProps) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-primary font-semibold ring-2 ring-border",
        SIZE_CLASSES[size],
        className
      )}
    >
      {photoUrl ? (
        // Firebase Storage URLs aren't on the next/image remote allowlist; the rest of
        // the app also renders user-supplied/external images with a plain <img>.
        <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
}
