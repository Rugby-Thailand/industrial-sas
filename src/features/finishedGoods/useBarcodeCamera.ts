"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { IScannerControls } from "@zxing/browser";

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
  // Serialize startup: an old decoder must settle before another attaches to the video.
  const startup = useRef<Promise<void>>(Promise.resolve());
  const deliver = useEffectEvent((code: string) => onCode(code));

  useEffect(() => {
    const token = ++generation.current;
    let disposed = false;
    let stream: MediaStream | undefined;
    let controls: IScannerControls | undefined;
    const video = videoRef.current;
    const current = () => !disposed && token === generation.current;
    const release = () => {
      stopDecoder(controls);
      stream?.getTracks().forEach((track) => track.stop());
      if (video && video.srcObject === stream) video.srcObject = null;
      if (controlsRef.current === controls) controlsRef.current = null;
    };
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
          video: { facingMode: { ideal: "environment" } },
        });
        if (!current()) {
          release();
          return;
        }
        const seen = new Map<string, number>();
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
              const code = result.getText().trim();
              const now = Date.now();
              if (!code || now - (seen.get(code) ?? -Infinity) < 1000) return;
              for (const [oldCode, time] of seen)
                if (now - time >= 1000) seen.delete(oldCode);
              seen.set(code, now);
              deliver(code);
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

  return {
    videoRef,
    state,
    error,
    torchAvailable,
    torchOn,
    toggleTorch,
    start: () => setAttempt((value) => value + 1),
  };
}
