"use client";

import { Spinner } from "@/components/ui/spinner";

import {
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { CameraOff, X } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";

/** Overlay controls sit on the live picture, so they keep a fixed light-on-dark contrast. */
export const cameraOverlayButtonClass =
  "size-11 rounded-full bg-black/65 text-white hover:bg-black/80 hover:text-white aria-pressed:bg-black/65 aria-pressed:text-yellow-200 aria-pressed:hover:bg-black/80";

/** Media inside a camera frame shows the whole feed: the frame follows its geometry. */
export const cameraMediaClass = "block h-full w-full object-contain";

/** Keep the preview and its controls together when a phone is turned sideways. */
export const fullscreenCameraLayoutClass =
  "flex min-h-0 flex-1 flex-col gap-3 [@media(orientation:landscape)_and_(max-height:35rem)]:grid [@media(orientation:landscape)_and_(max-height:35rem)]:grid-cols-[minmax(0,1fr)_minmax(17rem,36%)] [@media(orientation:landscape)_and_(max-height:35rem)]:grid-rows-[minmax(0,1fr)]";

export const fullscreenCameraDockClass =
  "shrink-0 space-y-2 rounded-lg border border-border bg-surface p-3 [@media(orientation:landscape)_and_(max-height:35rem)]:self-stretch [@media(orientation:landscape)_and_(max-height:35rem)]:overflow-y-auto";

/** The live frame tracks the actual feed so the preview never crops what is captured. */
export function useVideoAspect(initial = 4 / 3) {
  const [aspect, setAspect] = useState(initial);
  function measure(event: SyntheticEvent<HTMLVideoElement>) {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (videoWidth > 0 && videoHeight > 0) setAspect(videoWidth / videoHeight);
  }
  return {
    aspect,
    videoProps: { onLoadedMetadata: measure, onResize: measure },
  };
}

/**
 * The shared camera surface: one full-width frame, one close control at the
 * top right and an optional shutter at the bottom centre. A `content` frame
 * follows its media, with enough space to keep overlay touch controls visible.
 */
export function CameraFrame({
  status = "active",
  statusLabel,
  aspect = 4 / 3,
  onClose,
  closeLabel,
  shutter,
  topStart,
  layout = "camera",
  size = "default",
  hidden = false,
  children,
}: {
  status?: "starting" | "active" | "error";
  /** Announced while the camera starts. */
  statusLabel?: string;
  /** Width / height of the live feed. */
  aspect?: number;
  onClose?: (() => void) | undefined;
  closeLabel?: string;
  shutter?: { label: string; disabled: boolean; onPress: () => void };
  /** An optional hardware control, such as a supported flashlight. */
  topStart?: ReactNode;
  layout?: "camera" | "content";
  /**
   * A `large` live frame uses more vertical space in an inline screen.
   * A `fullscreen` frame fills the available stage inside a camera dialog.
   * Each size preserves the aspect ratio and shows the whole decoded frame.
   */
  size?: "default" | "large" | "fullscreen";
  hidden?: boolean;
  children: ReactNode;
}) {
  const live = layout === "camera" && status !== "error";
  const fullscreen = size === "fullscreen";
  const frame = (
    <div
      hidden={hidden}
      className={cn(
        "dark relative mx-auto overflow-hidden rounded-xl bg-black",
        fullscreen && "@container-size rounded-lg",
        layout === "content"
          ? "grid min-h-18 w-fit max-w-full min-w-18 place-items-center"
          : status === "error"
            ? "h-28 w-full"
            : "w-full",
      )}
      style={
        live
          ? ({
              aspectRatio: aspect,
              ...(fullscreen && {
                width: "min(100cqw, calc(100cqh * var(--camera-aspect)))",
                "--camera-aspect": aspect,
              }),
              // Inline frames reserve room for the controls outside the feed.
              maxWidth: fullscreen
                ? undefined
                : size === "large"
                  ? // Leaves room for the page heading, the search field and
                    // the control row below on a phone, with a floor for
                    // landscape screens.
                    `calc(max(15rem, min(100dvh - 10rem, 48rem)) * ${aspect})`
                  : `calc(min(60dvh, 28rem) * ${aspect})`,
            } as CSSProperties)
          : undefined
      }
    >
      {children}
      {status === "starting" && !hidden && (
        <p
          role="status"
          aria-live="polite"
          className="absolute inset-0 flex items-center justify-center gap-2 p-6 text-center text-sm text-white/80"
        >
          <Spinner aria-hidden="true" className="size-4" />
          {statusLabel}
        </p>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center text-white/70">
          <CameraOff aria-hidden="true" className="size-8" />
        </div>
      )}
      {topStart && <div className="absolute top-3 left-3">{topStart}</div>}
      {onClose && closeLabel && (
        <IconButton
          label={closeLabel}
          variant="ghost"
          className={cn("absolute top-3 right-3", cameraOverlayButtonClass)}
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-5 drop-shadow-sm" />
        </IconButton>
      )}
      {shutter && status !== "error" && (
        <button
          type="button"
          aria-label={shutter.label}
          disabled={shutter.disabled}
          onClick={shutter.onPress}
          className="absolute bottom-4 left-1/2 flex size-16 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white/80 bg-black/10 p-1 shadow-sm transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95 disabled:opacity-40"
        >
          <span
            aria-hidden="true"
            className="size-full rounded-full bg-white/15"
          />
        </button>
      )}
    </div>
  );
  if (!fullscreen) return frame;
  return (
    <div
      hidden={hidden}
      className="@container-size grid min-h-24 flex-1 place-items-center rounded-lg bg-black"
    >
      {frame}
    </div>
  );
}

/** Place the aiming guide inside the bounds of the displayed camera media. */
export function CameraGuide({
  shape,
}: {
  shape: "barcode" | "label" | "photo";
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
        shape === "barcode" && "h-[25%] w-[80%]",
        shape === "label" && "aspect-square w-[min(65cqw,55cqh)] max-w-[70%]",
        shape === "photo" && "h-[84%] w-[78%]",
      )}
    >
      <span className="absolute top-0 left-0 size-5 rounded-tl-sm border-t-[3px] border-l-[3px] border-white drop-shadow-[0_0_2px_black]" />
      <span className="absolute top-0 right-0 size-5 rounded-tr-sm border-t-[3px] border-r-[3px] border-white drop-shadow-[0_0_2px_black]" />
      <span className="absolute bottom-0 left-0 size-5 rounded-bl-sm border-b-[3px] border-l-[3px] border-white drop-shadow-[0_0_2px_black]" />
      <span className="absolute right-0 bottom-0 size-5 rounded-br-sm border-r-[3px] border-b-[3px] border-white drop-shadow-[0_0_2px_black]" />
    </div>
  );
}
