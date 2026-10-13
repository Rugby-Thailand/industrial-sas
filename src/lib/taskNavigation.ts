import { appHistoryIndex, APP_ROUTE_ORIGIN_KEY } from "./browser/appHistory";
import { guardedNavigate, safeInternalReturnHref } from "./navigationGuard";

type Replace = (href: string) => void;
function ownedOriginIndices(index: number): number[] {
  return [...new URLSearchParams(window.location.search).keys()].flatMap(
    (key) => {
      const ownIndex: unknown = window.history.state?.[`${key}OriginIndex`];
      return typeof window.history.state?.[`${key}Origin`] === "string" &&
        typeof ownIndex === "number" &&
        Number.isSafeInteger(ownIndex) &&
        ownIndex >= 0 &&
        ownIndex < index
        ? [ownIndex]
        : [];
    },
  );
}
function origin(): { href: string; index: number } | undefined {
  const value: unknown = window.history.state?.[APP_ROUTE_ORIGIN_KEY];
  if (
    !value ||
    typeof value !== "object" ||
    !("href" in value) ||
    !("index" in value) ||
    typeof value.href !== "string" ||
    typeof value.index !== "number" ||
    !Number.isSafeInteger(value.index) ||
    value.index < 0
  )
    return;
  const safe = safeInternalReturnHref(value.href, "");
  if (
    !safe ||
    new URL(safe, window.location.href).pathname === window.location.pathname ||
    value.index >= (appHistoryIndex() ?? 0)
  )
    return;
  return { href: safe, index: value.index };
}
/** Abandon the current task, consuming its foreground entries before its origin. */
export function returnFromTask(fallback: string, replace: Replace): void {
  const source = origin();
  guardedNavigate(() => {
    const index = appHistoryIndex() ?? 0;
    if (source) {
      window.history.go(source.index - index);
      return;
    }
    const taskIndex = Math.min(index, ...ownedOriginIndices(index));
    if (taskIndex > 0) {
      window.history.go(taskIndex - 1 - index);
      return;
    }
    const destination = safeInternalReturnHref(fallback, "/");
    if (index === 0) {
      replace(destination);
      return;
    }
    // A directly opened task has no app page before its foreground entries.
    // Consume the confirmations first, then replace the original task entry.
    const currentPath = window.location.pathname;
    window.addEventListener(
      "popstate",
      () => {
        if (window.location.pathname === currentPath && appHistoryIndex() === 0)
          replace(destination);
      },
      { once: true },
    );
    window.history.go(-index);
  });
}
/** A completed task must not reopen through Back after a modal review or edit. */
export function completeTask(
  destination: string,
  replace: Replace,
  options: { retainPage?: boolean } = {},
): void {
  const source = origin();
  const currentPath = window.location.pathname;
  guardedNavigate(() => {
    const index = appHistoryIndex() ?? 0;
    const barePath = (href: string) =>
      new URL(href, window.location.href).pathname.replace(
        /^\/(?:en|th)(?=\/|$)/,
        "",
      ) || "/";
    if (
      !options.retainPage &&
      source &&
      barePath(source.href) === barePath(destination)
    ) {
      window.history.go(source.index - index);
      return;
    }
    const distance =
      index -
      (options.retainPage
        ? Math.min(index, ...ownedOriginIndices(index)) + 1
        : source
          ? source.index + 1
          : Math.min(index, ...ownedOriginIndices(index)));
    if (distance <= 0) {
      replace(safeInternalReturnHref(destination, "/"));
      return;
    }
    window.addEventListener(
      "popstate",
      () => {
        if (window.location.pathname === currentPath)
          replace(safeInternalReturnHref(destination, "/"));
      },
      { once: true },
    );
    window.history.go(-distance);
  });
}
