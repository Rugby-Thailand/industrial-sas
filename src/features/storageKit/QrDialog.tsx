"use client";

import { QrCode } from "./QrCode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function QrDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  code,
  closeLabel,
  ariaLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly value: string;
  readonly code?: string;
  readonly closeLabel: string;
  readonly ariaLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={closeLabel}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        <QrCode value={value} label={ariaLabel} className="mx-auto" />
        {code === undefined ? null : (
          <p className="text-center text-sm">{code}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
