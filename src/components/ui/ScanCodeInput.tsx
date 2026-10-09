"use client";

import type { ComponentProps } from "react";
import { ScanBarcode } from "lucide-react";
import { IconButton } from "./IconButton";
import { Input } from "./input";
import { cn } from "@/lib/utils";

/** A code stays editable by keyboard; its adjacent action opens the owning scanner. */
export function ScanCodeInput({
  onScan,
  scanLabel,
  scanning = false,
  scanDisabled = false,
  scanDialog = false,
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
}) {
  return (
    <div className="relative min-w-0">
      <Input
        {...props}
        disabled={disabled}
        readOnly={readOnly}
        className={cn("min-h-12 pr-14 md:min-h-12", className)}
      />
      <IconButton
        label={scanLabel}
        variant="default"
        className="absolute top-1/2 right-0.5 size-11 shrink-0 -translate-y-1/2"
        disabled={disabled || readOnly || scanDisabled}
        aria-pressed={scanDialog ? undefined : scanning}
        aria-haspopup={scanDialog ? "dialog" : undefined}
        onClick={onScan}
      >
        <ScanBarcode className="size-5" aria-hidden="true" />
      </IconButton>
    </div>
  );
}
