"use client";

import { useQuery } from "convex/react";
import { MessageSquare } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

export function CustomerLineEntry({
  customerId,
}: {
  readonly customerId?: string;
}) {
  const viewer = useQuery(api.customerLine.groups.viewer, {});
  if (!viewer?.ok || !viewer.value.canRead) return null;

  const href = customerId
    ? `${ROUTES.customerLine}?${new URLSearchParams({ customerId })}`
    : ROUTES.customerLine;
  return (
    <Button asChild variant="outline">
      <Link href={href}>
        <MessageSquare className="size-4" aria-hidden="true" />
        LINE
      </Link>
    </Button>
  );
}
