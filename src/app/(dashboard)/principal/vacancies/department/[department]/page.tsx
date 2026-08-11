"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrincipalPipelineBoard } from "../../PrincipalPipelineBoard";

export default function PrincipalDepartmentVacanciesPage() {
  const { department } = useParams<{ department: string }>();
  const decodedDepartment = decodeURIComponent(department);
  const [scope, setScope] = useState<"active" | "closed">("active");

  return (
    <div className="space-y-6">
      <Link href="/principal/vacancies" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Departments
      </Link>

      <div>
        <h1 className="text-xl font-bold">{decodedDepartment}</h1>
        <p className="text-sm text-muted-foreground">
          {scope === "active"
            ? "Review and approve hiring requests — from request to hiring results in one view"
            : "Completed and rejected hiring requests"}
        </p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>
          Active
        </Button>
        <Button size="sm" variant={scope === "closed" ? "default" : "outline"} onClick={() => setScope("closed")}>
          Past
        </Button>
      </div>

      <PrincipalPipelineBoard scope={scope} department={decodedDepartment} />
    </div>
  );
}
