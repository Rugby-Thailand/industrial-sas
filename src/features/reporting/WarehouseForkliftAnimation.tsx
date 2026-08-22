"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { DotLottie } from "@lottiefiles/dotlottie-web";

const CENTER_FRAME = 55;

type AnimationState = "loading" | "playing" | "frozen" | "fallback";

/**
 * Plays the supplied forklift entrance once, then holds the centered frame.
 *
 * The original animation continues past the useful composition and drives the
 * forklift back out of view. Restricting playback to the measured center frame
 * makes the motion communicate arrival without becoming a looping distraction.
 * Reduced-motion users and failed loads receive the same centered frame as a
 * small static image.
 */
export function WarehouseForkliftAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [state, setState] = useState<AnimationState>("loading");

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(media.matches);

    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) return;

    const canvas = canvasRef.current;
    if (canvas === null) return;

    let disposed = false;
    let player: DotLottie | undefined;

    void import("@lottiefiles/dotlottie-web")
      .then(({ DotLottie }) => {
        if (disposed) return;

        player = new DotLottie({
          autoplay: true,
          canvas,
          layout: { align: [0.5, 0.5], fit: "contain" },
          loop: false,
          renderConfig: {
            autoResize: true,
            devicePixelRatio: Math.min(window.devicePixelRatio, 2),
            freezeOnOffscreen: true,
          },
          segment: [0, CENTER_FRAME],
          src: new URL(
            "/assets/warehouse/forklift-arrival.lottie",
            window.location.origin,
          ).href,
        });

        player.addEventListener("play", () => setState("playing"));
        player.addEventListener("complete", () => {
          player?.setFrame(CENTER_FRAME);
          player?.pause();
          setState("frozen");
        });
        player.addEventListener("loadError", () => setState("fallback"));
        player.addEventListener("renderError", () => setState("fallback"));
      })
      .catch(() => setState("fallback"));

    return () => {
      disposed = true;
      player?.destroy();
    };
  }, [reduceMotion]);

  const visualState = reduceMotion ? "fallback" : state;

  return (
    <div
      aria-hidden="true"
      className="relative flex size-full min-h-52 items-center justify-center"
      data-animation-state={visualState}
      data-testid="warehouse-forklift-animation"
    >
      {visualState === "fallback" ? (
        <Image
          src="/assets/warehouse/forklift-still.png"
          alt=""
          width={480}
          height={270}
          priority
          className="h-auto w-full max-w-sm object-contain opacity-85"
        />
      ) : (
        <canvas
          ref={canvasRef}
          width={480}
          height={270}
          className="h-auto w-full max-w-sm"
        />
      )}
    </div>
  );
}
