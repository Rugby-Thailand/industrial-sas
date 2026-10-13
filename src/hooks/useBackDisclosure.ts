"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { useWorkflowStep } from "./useWorkflowStep";
import { guardedNavigate } from "@/lib/navigationGuard";

/** Native foreground entry shared by every Dialog and Sheet. */
export function useBackDisclosure(
  open: boolean,
  change: (open: boolean) => void,
  options: { managed?: boolean; blocked?: boolean; draftScope?: string } = {},
) {
  const id = useId().replaceAll(":", "");
  const scope = options.draftScope ?? id;
  const managed = options.managed !== false;
  const closing = useRef(false);
  const reenter = useRef<() => void>(() => undefined);
  const latest = useRef({ open, change });
  useLayoutEffect(() => {
    latest.current = { open, change };
  });
  const step = useWorkflowStep(
    `overlay${id}`,
    `foreground:${scope}`,
    managed,
    () => {
      if (closing.current) {
        closing.current = false;
        if (latest.current.open) {
          queueMicrotask(() => reenter.current());
          return;
        }
      }
      if (managed && latest.current.open) latest.current.change(false);
    },
    {
      priority: 100,
      blocked: !!options.blocked,
      onForward: () => {
        if (managed && !latest.current.open) latest.current.change(true);
      },
    },
  );
  useLayoutEffect(() => {
    reenter.current = step.enter;
  });
  const previous = useRef(false);
  useLayoutEffect(() => {
    if (!managed) return;
    if (open && !previous.current && !step.active) step.enter();
    if (!open && previous.current && step.active) {
      closing.current = true;
      step.back();
    }
    previous.current = open;
  });
  useLayoutEffect(() => {
    if (!managed || !options.blocked) return;
    const preventDeparture = (event: PopStateEvent) => {
      if (!new URLSearchParams(window.location.search).has(`overlay${id}`)) {
        event.stopImmediatePropagation();
        window.history.forward();
      }
    };
    window.addEventListener("popstate", preventDeparture, true);
    return () => window.removeEventListener("popstate", preventDeparture, true);
  }, [managed, options.blocked, id]);
  return {
    scope,
    complete: step.complete,
    onOpenChange: (next: boolean) => {
      if (!next && options.blocked) return;
      if (!next && managed && step.active)
        guardedNavigate(() => change(false), {
          preserveDraftScope: `foreground:${scope}`,
        });
      else change(next);
    },
  };
}
