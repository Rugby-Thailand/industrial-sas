"use client";

import type { ComponentProps, ReactNode } from "react";
import { IconButton } from "./IconButton";
import { Input } from "./input";
import { ScanIcon } from "./ScanIcon";
import { cn } from "@/lib/utils";

/** A code stays editable by keyboard; its adjacent action opens the owning scanner. */
export function ScanCodeInput({
  onScan,
  scanLabel,
  scanning = false,
  scanDisabled = false,
  scanDialog = false,
  trailingAction,
  className,
  disabled,
  readOnly,
  ...props
}: ComponentProps<typeof Input> & {
  onScan: () => void;
  scanLabel: string;
  scanning?: boolean;
  scanDisabled?: boolean;
  scanDialog?: boolean;
  trailingAction?: ReactNode;
}) {
  return (
    <div className="relative min-w-0">
      <Input
        {...props}
        disabled={disabled}
        readOnly={readOnly}
        className={cn(
          "min-h-12 pr-14 md:min-h-12",
          trailingAction && "pr-26",
          className,
        )}
      />
      {/* Keep centering separate from the button's press translation. */}
      <div className="absolute inset-y-0 right-0.5 flex items-center">
        <IconButton
          label={scanLabel}
          variant="ghost"
          className="size-11 shrink-0"
          disabled={disabled || readOnly || scanDisabled}
          aria-pressed={scanDialog ? undefined : scanning}
          aria-haspopup={scanDialog ? "dialog" : undefined}
          onClick={onScan}
        >
          <ScanIcon className="size-5" aria-hidden="true" />
        </IconButton>
        {trailingAction}
      </div>
    </div>
  );
}
