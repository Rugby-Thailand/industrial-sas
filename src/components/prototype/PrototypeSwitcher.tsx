"use client";

import { ArrowLeft, ArrowRight, FlaskConical } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";

export interface PrototypeVariant {
  readonly id: string;
  readonly label: string;
}

export function PrototypeSwitcher({
  variants,
  current,
  label,
  previousLabel,
  nextLabel,
  parameter = "variant",
}: {
  readonly variants: readonly PrototypeVariant[];
  readonly current: string;
  readonly label: string;
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly parameter?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentIndex = Math.max(
    0,
    variants.findIndex((variant) => variant.id === current),
  );

  const move = (offset: number) => {
    if (variants.length === 0) return;
    const nextIndex =
      (currentIndex + offset + variants.length) % variants.length;
    const next = variants[nextIndex];
    if (next === undefined) return;

    const query = Object.fromEntries(searchParams.entries());
    query[parameter] = next.id;
    router.replace({ pathname, query }, { scroll: false });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const selected = variants[currentIndex];
  if (selected === undefined) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label={label}
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-zinc-950/95 p-1.5 text-white shadow-2xl ring-1 ring-black/25 backdrop-blur"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full text-white hover:bg-white/15 hover:text-white"
          aria-label={previousLabel}
          title={previousLabel}
          onClick={() => move(-1)}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </Button>
        <div className="flex min-w-0 items-center gap-2 px-2">
          <FlaskConical
            aria-hidden="true"
            className="size-4 shrink-0 text-sky-300"
          />
          <span className="truncate text-sm font-semibold" aria-live="polite">
            {selected.label}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full text-white hover:bg-white/15 hover:text-white"
          aria-label={nextLabel}
          title={nextLabel}
          onClick={() => move(1)}
        >
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  );
}
