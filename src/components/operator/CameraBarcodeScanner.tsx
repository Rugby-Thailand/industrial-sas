"use client";

import {
  AlertTriangle,
  Camera,
  Keyboard,
  LoaderCircle,
  ScanLine,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CameraState = "STARTING" | "READY" | "DENIED" | "ERROR";
const CAMERA_START_TIMEOUT_MS = 12_000;

export function CameraBarcodeScanner({
  triggerLabel,
  onDetected,
  className,
}: {
  readonly triggerLabel: string;
  readonly onDetected: (value: string) => void;
  readonly className?: string;
}) {
  const t = useTranslations("CameraScanner");
  const [open, setOpen] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState>("STARTING");
  const [manualValue, setManualValue] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;

    let active = true;
    let stop: (() => void) | undefined;
    const startTimeout = window.setTimeout(() => {
      if (active && stop === undefined) setCameraState("ERROR");
    }, CAMERA_START_TIMEOUT_MS);
    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (!active || videoRef.current === null) return;

        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 150,
        });
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: { facingMode: { ideal: "environment" } },
          },
          videoRef.current,
          (result, _error, callbackControls) => {
            if (!active || result === undefined) return;
            const value = result.getText().trim();
            if (value === "") return;

            active = false;
            callbackControls.stop();
            onDetected(value);
            setOpen(false);
          },
        );
        window.clearTimeout(startTimeout);
        if (!active) {
          controls.stop();
          return;
        }
        stop = controls.stop;
        setCameraState("READY");
      } catch (error) {
        window.clearTimeout(startTimeout);
        if (!active) return;
        const name = error instanceof Error ? error.name : "";
        setCameraState(name === "NotAllowedError" ? "DENIED" : "ERROR");
      }
    };

    void start();
    return () => {
      active = false;
      window.clearTimeout(startTimeout);
      stop?.();
    };
  }, [onDetected, open]);

  const updateOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setCameraState("STARTING");
      setManualValue("");
    }
  };
  const submitManual = () => {
    const value = manualValue.trim();
    if (value === "") return;
    onDetected(value);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={updateOpen}>
      <Button
        type="button"
        className={className}
        onClick={() => updateOpen(true)}
      >
        <ScanLine aria-hidden="true" />
        {triggerLabel}
      </Button>

      <DialogContent closeLabel={t("close")} className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera aria-hidden="true" className="size-5 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-canvas">
          <video
            ref={videoRef}
            aria-label={t("videoLabel")}
            className="size-full object-cover"
            muted
            playsInline
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[14%] rounded-2xl border-2 border-primary shadow-[0_0_0_999px_rgb(0_0_0/0.32)]"
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/65 px-4 py-3 text-center text-sm text-white">
            {cameraState === "STARTING" ? (
              <span className="flex items-center gap-2">
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
                {t("starting")}
              </span>
            ) : cameraState === "READY" ? (
              t("ready")
            ) : (
              <span className="flex items-center gap-2">
                <AlertTriangle aria-hidden="true" className="size-4" />
                {cameraState === "DENIED" ? t("denied") : t("unavailable")}
              </span>
            )}
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted" role="status">
          {cameraState === "DENIED"
            ? t("deniedHint")
            : cameraState === "ERROR"
              ? t("unavailableHint")
              : t("privacyHint")}
        </p>

        <form
          className="grid gap-3 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            submitManual();
          }}
        >
          <div className="flex items-center gap-2">
            <Keyboard aria-hidden="true" className="size-4 text-muted" />
            <Label htmlFor="camera-scanner-manual-value">
              {t("manualLabel")}
            </Label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="camera-scanner-manual-value"
              value={manualValue}
              autoComplete="off"
              placeholder={t("manualPlaceholder")}
              onChange={(event) => setManualValue(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={manualValue.trim() === ""}
            >
              {t("useCode")}
            </Button>
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            {t("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
