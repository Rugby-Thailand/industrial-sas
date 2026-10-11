"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import { guardedNavigate } from "@/lib/navigationGuard";

const NO_PARAMS = new URLSearchParams();

/** The current query string; empty outside the Next router (e.g. tests). */
export function useQueryParams(): Pick<URLSearchParams, "get" | "toString"> {
  return useSearchParams() ?? NO_PARAMS;
}

/**
 * State that follows the URL: it resets to `fromUrl` whenever `urlKey`
 * changes (load, Back/Forward, a search deep link), and can be set locally
 * in between while the matching URL is pushed. Resetting during render
 * avoids an effect frame showing the previous record.
 */
export function useUrlBackedState<Value>(
  urlKey: string,
  fromUrl: Value,
): readonly [Value, (value: Value) => void] {
  const [entry, setEntry] = useState({ urlKey, value: fromUrl });
  if (entry.urlKey !== urlKey) {
    setEntry({ urlKey, value: fromUrl });
    return [fromUrl, (value) => setEntry({ urlKey, value })];
  }
  return [entry.value, (value) => setEntry({ urlKey, value })];
}

/**
 * Same-page URL changes (record selection, tab, version) through the
 * unsaved-work guard. `run` applies the local state change, then the URL is
 * pushed without scrolling to the top.
 */
export function useGuardedUrl() {
  const router = useRouter();
  return useCallback(
    (href: string, run?: () => void, mode: "push" | "replace" = "push"): void =>
      guardedNavigate(() => {
        run?.();
        router[mode](href, { scroll: false });
      }),
    [router],
  );
}

/**
 * Move to a deep-link target once its data and permission have settled:
 * bring it into view in its own scroll container at once, focus it and
 * outline it briefly. Runs once per `token` (one navigation), never before `ready`.
 */
export function useDeepLinkFocus(
  targetId: string | null,
  ready: boolean,
  token: string,
): void {
  const done = useRef<string | null>(null);
  const key = targetId === null ? null : `${token}#${targetId}`;
  useEffect(() => {
    if (!ready || key === null || targetId === null || done.current === key)
      return;
    const element = document.getElementById(targetId);
    if (element === null) return;
    done.current = key;
    if (!element.hasAttribute("tabindex"))
      element.setAttribute("tabindex", "-1");
    // Jump, never animate: a smooth scroll here did not move the page, which
    // left the linked section focused but out of view.
    element.scrollIntoView?.({ block: "start", behavior: "auto" });
    element.focus({ preventScroll: true });
    element.setAttribute("data-deep-link-target", "");
    const clear = () => element.removeAttribute("data-deep-link-target");
    window.setTimeout(clear, 2400);
    element.addEventListener("blur", clear, { once: true });
  });
}
