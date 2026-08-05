import Link from "next/link";
import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <Construction className="h-12 w-12 text-muted-foreground/40" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Feature under development</h1>
            <p className="text-muted-foreground text-sm">
              This feature isn&apos;t available yet.
            </p>
          </div>
          <Button asChild>
            <Link href="/">Go home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
