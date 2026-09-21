"use client";

import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";

/** Keep QR contrast and its quiet zone independent of the current app theme. */
export function QrCode({
  value,
  label,
  size = 208,
  padding = 16,
  level = "L",
  className,
}: {
  readonly value: string;
  readonly label: string;
  readonly size?: number;
  readonly padding?: number;
  readonly className?: string;
  readonly level?: "L" | "M" | "Q" | "H";
}) {
  return (
    <div
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-lg bg-white",
        className,
      )}
      style={{ padding }}
    >
      <QRCodeSVG
        level={level}
        value={value}
        size={size}
        title={label}
        aria-label={label}
        role="img"
        className="block"
      />
    </div>
  );
}
