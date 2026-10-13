"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { completeTask } from "@/lib/taskNavigation";

/** Publish a successful task's destination after draft/pending registration settles. */
export function useTaskCompletion(
  pending: boolean,
  options: { retainPage?: boolean } = {},
) {
  const router = useRouter();
  const [destination, setDestination] = useState<string>();
  const mounted = useRef(false);
  const page = useRef("");
  useLayoutEffect(() => {
    mounted.current = true;
    page.current = window.location.pathname;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (pending || destination === undefined) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !mounted.current) return;
      setDestination(undefined);
      if (page.current === window.location.pathname)
        completeTask(destination, router.replace, {
          retainPage: !!options.retainPage,
        });
    });
    return () => {
      cancelled = true;
    };
  }, [pending, destination, router, options.retainPage]);
  return setDestination;
}
