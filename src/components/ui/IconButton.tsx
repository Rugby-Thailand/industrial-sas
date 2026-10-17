"use client";

import { Spinner } from "@/components/ui/spinner";

import type { ComponentProps, ReactNode } from "react";
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
  /** Keep keyboard focus when a pending action may retain the current page. */
  keepFocusWhilePending?: boolean;
  tooltip?: ReactNode;
};

/** One accessible name for the icon action and its hover explanation. */
export function IconButton({
  label,
  pending = false,
  keepFocusWhilePending = false,
  disabled,
  onClick,
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
      aria-disabled={
        (pending && keepFocusWhilePending) || props["aria-disabled"]
      }
      disabled={disabled || (pending && !keepFocusWhilePending)}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    >
      {pending ? <Spinner aria-hidden="true" /> : children}
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
