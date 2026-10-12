"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createShutterSound, type ShutterSound } from "./playShutterSound";

export type StillCameraState = "starting" | "on" | "error";

const MAX_PIXELS = 40_000_000;

/**
 * One rear-camera stream for still photos. Every accepted capture plays one
 * shutter click; a closed, unmounted or replaced session ignores late grants
 * and late encodes.
 */
export function useStillPhotoCamera({
  onPhoto,
  fileName,
  canCapture,
  stopAfterCapture = false,
}: {
  onPhoto: (file: File) => void;
  fileName: () => string;
  /** Read at the press and again at delivery, so a filled limit drops a late photo. */
  canCapture?: () => boolean;
  /** Release the stream before handing over a single photo. */
  stopAfterCapture?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const sound = useRef<ShutterSound | null>(null);
  const latest = useRef({ onPhoto, fileName, canCapture, stopAfterCapture });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<StillCameraState>("starting");

  useEffect(() => {
    latest.current = { onPhoto, fileName, canCapture, stopAfterCapture };
  });

  const stop = useCallback(() => {
    generation.current++;
    pending.current = false;
    media.current?.getTracks().forEach((track) => track.stop());
    media.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(
    () => () => {
      sound.current?.dispose();
      sound.current = null;
    },
    [],
  );

  useEffect(() => {
    const token = ++generation.current;
    const element = videoRef.current;
    const open = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || !element)
          throw new Error("UNAVAILABLE");
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
        });
        if (token !== generation.current) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        media.current = acquired;
        element.srcObject = acquired;
        await element.play();
        if (token === generation.current) setState("on");
      } catch {
        if (token !== generation.current) return;
        media.current?.getTracks().forEach((track) => track.stop());
        media.current = null;
        if (element) element.srcObject = null;
        setState("error");
      }
    };
    void open();
    return () => {
      stop();
      if (element) element.srcObject = null;
    };
  }, [attempt, stop]);

  function fail() {
    stop();
    setState("error");
  }

  function capture() {
    const element = videoRef.current;
    const allowed = latest.current.canCapture ?? (() => true);
    if (
      state !== "on" ||
      pending.current ||
      !element?.videoWidth ||
      !element.videoHeight ||
      !allowed()
    )
      return;
    // The press is the only moment browsers reliably allow audio to start.
    sound.current ??= createShutterSound();
    sound.current.prime();
    pending.current = true;
    const token = generation.current;
    const canvas = document.createElement("canvas");
    const release = () => {
      canvas.width = canvas.height = 0;
    };
    try {
      if (element.videoWidth * element.videoHeight > MAX_PIXELS)
        throw new Error("SIZE");
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("CANVAS");
      context.drawImage(element, 0, 0);
      canvas.toBlob(
        (blob) => {
          release();
          // stop() advances the generation: closed or replaced sessions stay silent.
          if (token !== generation.current) return;
          pending.current = false;
          if (!blob) {
            fail();
            return;
          }
          const current = latest.current;
          if (current.canCapture && !current.canCapture()) return;
          if (current.stopAfterCapture) stop();
          sound.current?.play();
          current.onPhoto(
            new File([blob], current.fileName(), { type: "image/jpeg" }),
          );
        },
        "image/jpeg",
        0.9,
      );
    } catch {
      release();
      fail();
    }
  }

  function retry() {
    stop();
    setState("starting");
    setAttempt((value) => value + 1);
  }

  return { videoRef, state, capture, stop, retry };
}
