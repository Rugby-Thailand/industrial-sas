/** Change only owned query parameters, preserving the hash and other features' state. */
export function updateBrowserQuery(
  change: (query: URLSearchParams) => void,
  options: {
    mode?: "push" | "replace";
    metadata?: Record<string, unknown>;
    event?: string;
  } = {},
) {
  const url = new URL(window.location.href);
  change(url.searchParams);
  const state = { ...window.history.state, ...options.metadata };
  // Let Next's patched API synchronize URL changes rather than treating them as internal.
  delete state.__NA;
  delete state._N;
  window.history[options.mode === "push" ? "pushState" : "replaceState"](
    state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  if (options.event) window.dispatchEvent(new Event(options.event));
}

/** Metadata-only writes must retain Next's router markers and omit a URL. */
export function updateHistoryMetadata(
  change: (state: Record<string, unknown>) => void,
) {
  const state = { ...window.history.state };
  change(state);
  window.history.replaceState(state, "");
}
export function subscribeBrowserQuery(event: string, listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(event, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(event, listener);
  };
}
