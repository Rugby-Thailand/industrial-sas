"use client";

import type { ComponentProps, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type IconButtonProps = Omit<
  ComponentProps<typeof Button>,
  "size" | "aria-label" | "title"
> & {
  label: string;
  pending?: boolean;
  tooltip?: ReactNode;
};

/** One accessible name for the icon action and its hover explanation. */
export function IconButton({
  label,
  pending = false,
  disabled,
  children,
  type = "button",
  variant = "outline",
  tooltip,
  asChild = false,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      {...props}
      type={type}
      variant={variant}
      size="icon"
      asChild={asChild}
      aria-label={label}
      title={tooltip === undefined ? label : undefined}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="animate-spin" />
      ) : (
        children
      )}
    </Button>
  );
  if (tooltip === undefined) return button;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
