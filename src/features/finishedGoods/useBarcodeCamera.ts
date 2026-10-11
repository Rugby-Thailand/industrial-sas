"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { IScannerControls } from "@zxing/browser";
import { decodeBarcodeCanvas } from "./barcodeDecoder";

export type BarcodeCameraState =
  "OFF" | "STARTING" | "ACTIVE" | "UNAVAILABLE" | "ERROR";
export type BarcodeCameraError =
  "PERMISSION" | "UNAVAILABLE" | "DECODER" | "TORCH";

// ZXing types stop() as void, but its torch-enabled implementation returns a
// promise that can reject when the track is already ended. Always stop our own
// tracks too, and contain that optional torch shutdown failure.
function stopDecoder(controls: IScannerControls | undefined) {
  if (!controls) return;
  try {
    void Promise.resolve(controls.stop()).catch(() => undefined);
  } catch {
    // Stream ownership below still guarantees physical camera shutdown.
  }
}

/** Acquisition only: canonical identity validation and deduplication belong to the session. */
export function useBarcodeCamera({
  active,
  mode,
  onCode,
}: {
  active: boolean;
  mode: "PACKAGES" | "LOCATION";
  onCode: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<BarcodeCameraState>("OFF");
  const [error, setError] = useState<BarcodeCameraError | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const controlsRef = useRef<IScannerControls | null>(null);
  const generation = useRef(0);
  const releaseRef = useRef<(() => void) | null>(null);
  // Serialize startup: an old decoder must settle before another attaches to the video.
  const startup = useRef<Promise<void>>(Promise.resolve());
  const deliver = useEffectEvent((code: string) => onCode(code));

  useEffect(() => {
    const token = ++generation.current;
    let disposed = false;
    let stream: MediaStream | undefined;
    let controls: IScannerControls | undefined;
    const fallbackAbort = new AbortController();
    const video = videoRef.current;
    const current = () => !disposed && token === generation.current;
    const release = () => {
      fallbackAbort.abort();
      stopDecoder(controls);
      stream?.getTracks().forEach((track) => track.stop());
      if (video && video.srcObject === stream) video.srcObject = null;
      if (controlsRef.current === controls) controlsRef.current = null;
    };
    releaseRef.current = release;
    const run = async () => {
      if (!current()) return;
      setError(null);
      setTorchAvailable(false);
      setTorchOn(false);
      if (!active || !video) {
        setState("OFF");
        return;
      }
      setState("STARTING");
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setState("UNAVAILABLE");
          setError("UNAVAILABLE");
          return;
        }
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (!current()) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (!current()) {
          release();
          return;
        }
        const seen = new Map<string, number>();
        let fallbackPending = false;
        let fallbackAt = 0;
        function accept(raw: string) {
          if (!current()) return;
          const code = raw.trim();
          const now = Date.now();
          if (!code || now - (seen.get(code) ?? -Infinity) < 1000) return;
          for (const [oldCode, time] of seen)
            if (now - time >= 1000) seen.delete(oldCode);
          seen.set(code, now);
          deliver(code);
        }
        async function fallback() {
          if (
            !video?.videoWidth ||
            !current() ||
            fallbackPending ||
            Date.now() < fallbackAt
          )
            return;
          fallbackPending = true;
          fallbackAt = Date.now() + 1500;
          const frame = document.createElement("canvas");
          const scale = Math.min(
            1,
            2400 / Math.max(video.videoWidth, video.videoHeight),
          );
          frame.width = Math.round(video.videoWidth * scale);
          frame.height = Math.round(video.videoHeight * scale);
          try {
            const context = frame.getContext("2d");
            if (!context) return;
            context.drawImage(video, 0, 0, frame.width, frame.height);
            const codes = await decodeBarcodeCanvas(frame, {
              signal: fallbackAbort.signal,
              budgetMs: 1200,
            });
            // A location or field scan must never guess between distinct codes.
            if (codes.length === 1) accept(codes[0]!);
          } catch {
            // The ordinary stream decoder remains active; image selection is available.
          } finally {
            frame.width = 0;
            frame.height = 0;
            fallbackPending = false;
          }
        }
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanSuccess: 100,
          delayBetweenScanAttempts: 100,
        });
        controls = await reader.decodeFromStream(
          stream,
          video,
          (result, decodeError, callbackControls) => {
            if (!current()) {
              stopDecoder(callbackControls);
              return;
            }
            if (result) {
              accept(result.getText());
            } else if (
              decodeError &&
              ![
                "NotFoundException",
                "ChecksumException",
                "FormatException",
              ].includes(
                typeof decodeError.getKind === "function"
                  ? decodeError.getKind()
                  : decodeError.name,
              )
            ) {
              disposed = true;
              stopDecoder(callbackControls);
              release();
              setState("ERROR");
              setError("DECODER");
              setTorchAvailable(false);
              setTorchOn(false);
            } else {
              void fallback();
            }
          },
        );
        if (!current()) {
          release();
          return;
        }
        controlsRef.current = controls;
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as
          (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        setTorchAvailable(Boolean(capabilities?.torch && controls.switchTorch));
        setState("ACTIVE");
      } catch (cause) {
        release();
        if (!current()) return;
        const name =
          typeof cause === "object" && cause !== null && "name" in cause
            ? cause.name
            : "";
        setState("ERROR");
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "PERMISSION"
            : "UNAVAILABLE",
        );
      }
    };
    startup.current = startup.current.then(run);
    return () => {
      disposed = true;
      release();
    };
  }, [active, mode, attempt]);

  const toggleTorch = useCallback(async () => {
    const controls = controlsRef.current;
    const token = generation.current;
    if (!controls?.switchTorch) return;
    try {
      await controls.switchTorch(!torchOn);
      if (token === generation.current && controlsRef.current === controls)
        setTorchOn(!torchOn);
    } catch {
      if (token === generation.current && controlsRef.current === controls) {
        setError("TORCH");
        setTorchAvailable(false);
      }
    }
  }, [torchOn]);

  // Single-shot consumers invalidate callbacks before their first accepted result renders.
  const stop = useCallback(() => {
    generation.current += 1;
    releaseRef.current?.();
  }, []);

  return {
    videoRef,
    state,
    error,
    torchAvailable,
    torchOn,
    toggleTorch,
    stop,
    start: () => setAttempt((value) => value + 1),
  };
}
