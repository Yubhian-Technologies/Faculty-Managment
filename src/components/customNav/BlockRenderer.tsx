"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { isSafeHref, isSafeImageUrl } from "@/lib/customNav/safeUrl";
import type { CustomPageBlock } from "@/types";

// Renders a custom page's blocks. Everything is plain React (text is rendered as
// text, never as HTML) and every link is re-checked here, so even a block that
// somehow bypassed server validation cannot produce a script link.

function SafeLink({ href, newTab, className, children }: { href: string; newTab?: boolean; className?: string; children: React.ReactNode }) {
  if (!isSafeHref(href)) return <span className={cn("text-muted-foreground", className)}>{children}</span>;
  const internal = href.startsWith("/");
  if (internal && !newTab) return <Link href={href} className={className}>{children}</Link>;
  return (
    <a href={href} target={newTab || !internal ? "_blank" : undefined} rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

const TONES = {
  info: { box: "border-blue-200 bg-blue-50 text-blue-900", Icon: Info },
  success: { box: "border-green-200 bg-green-50 text-green-900", Icon: CheckCircle2 },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
} as const;

export function BlockView({ block }: { block: CustomPageBlock }) {
  switch (block.type) {
    case "heading": {
      const cls = block.level === 1 ? "text-2xl font-bold" : block.level === 2 ? "text-xl font-semibold" : "text-lg font-semibold";
      return <p role="heading" aria-level={block.level + 1} className={cn(cls, "break-words")}>{block.text}</p>;
    }
    case "text":
      return <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{block.text}</p>;
    case "button":
      return (
        <div>
          <Button asChild variant={block.variant === "outline" ? "outline" : "default"} disabled={!isSafeHref(block.href)}>
            <SafeLink href={block.href} newTab={block.newTab}>
              {block.label}
              {(block.newTab || !block.href.startsWith("/")) && <ExternalLink className="h-4 w-4 ml-2" />}
            </SafeLink>
          </Button>
        </div>
      );
    case "image":
      return isSafeImageUrl(block.url) ? (
        <figure className="space-y-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.alt} className="max-w-full h-auto rounded-md border" loading="lazy" referrerPolicy="no-referrer" />
          {block.caption && <figcaption className="text-xs text-muted-foreground">{block.caption}</figcaption>}
        </figure>
      ) : null;
    case "divider":
      return <hr className="border-border" />;
    case "linkList":
      return (
        <Card>
          {block.title && <CardHeader className="pb-2"><CardTitle className="text-base break-words">{block.title}</CardTitle></CardHeader>}
          <CardContent className={cn("space-y-1.5", !block.title && "pt-4")}>
            {block.links.map((l, i) => (
              <div key={i}>
                <SafeLink href={l.href} newTab={l.newTab} className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 break-all">
                  {l.label}
                  {(l.newTab || !l.href.startsWith("/")) && <ExternalLink className="h-3.5 w-3.5 shrink-0" />}
                </SafeLink>
              </div>
            ))}
          </CardContent>
        </Card>
      );
    case "infoCard": {
      const { box, Icon } = TONES[block.tone] ?? TONES.info;
      return (
        <div className={cn("flex gap-3 rounded-lg border p-4", box)}>
          <Icon className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold break-words">{block.title}</p>
            <p className="text-sm whitespace-pre-wrap break-words">{block.body}</p>
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

export function BlockRenderer({ blocks }: { blocks: CustomPageBlock[] }) {
  if (blocks.length === 0) return <p className="text-sm text-muted-foreground">This page has no content yet.</p>;
  return (
    <div className="space-y-4 max-w-3xl">
      {blocks.map((b) => <BlockView key={b.id} block={b} />)}
    </div>
  );
}
