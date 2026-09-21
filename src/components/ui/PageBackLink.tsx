"use client";

import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";

export function PageBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-touch max-w-full items-center gap-2 rounded-sm text-sm text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
      <span className="break-words">{label}</span>
    </Link>
  );
}
