"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// HR Admin no longer creates vacancy requests — Dept Heads do.
// This route redirects to the vacancies list.
export default function HRVacancyNewRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/hr-admin/vacancies");
  }, [router]);
  return null;
}
