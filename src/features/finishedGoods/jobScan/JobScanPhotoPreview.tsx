"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function JobScanPhotoPreview({
  src,
  thumbnailClassName,
  triggerClassName,
}: {
  readonly src: string;
  readonly thumbnailClassName: string;
  readonly triggerClassName?: string;
}) {
  const t = useTranslations("JobScan");
  const app = useTranslations("App");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t("openPhoto")}
          className={cn(
            "shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            triggerClassName,
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob or remote upload preview */}
          <img src={src} alt="" className={cn(thumbnailClassName)} />
        </button>
      </DialogTrigger>
      <DialogContent
        size="wide"
        closeLabel={app("close")}
        aria-describedby={undefined}
        className="p-3 sm:p-4"
      >
        <DialogTitle className="sr-only">{t("openPhoto")}</DialogTitle>
        {/* eslint-disable-next-line @next/next/no-img-element -- preserve original uploaded resolution */}
        <img
          src={src}
          alt={t("openPhoto")}
          className="max-h-[calc(100dvh-7rem)] w-full rounded-md object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}
