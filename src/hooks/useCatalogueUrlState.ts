"use client";

import { useMemo, useState } from "react";
import { useBrowserQuery } from "./useBrowserQuery";
import { useQueryHistoryWriter } from "./useQueryHistoryWriter";
import {
  getCommittedBrowserQuery,
  getServerBrowserQuery,
  updateBrowserQuery,
} from "@/lib/browser/history";
import { preferences } from "@/lib/browser/storage";

type CatalogueCodec<T> = {
  decode: (encoded: string | null) => T;
  encode: (state: T) => string | null;
  readPreference: (value: unknown) => T;
  writePreference: (state: T) => unknown;
};
type CatalogueOptions<T> = {
  parameter: string;
  scopeField: string;
  event: string;
  codec: CatalogueCodec<T>;
};

/** URL/history mechanics are shared; validation and persisted formats stay feature-owned. */
export function useCatalogueUrlState<T extends { search: string }>(
  scope: string,
  { parameter, scopeField, event, codec }: CatalogueOptions<T>,
) {
  const initial = useMemo(
    () =>
      codec.encode(
        preferences.read(scope, codec.readPreference, codec.decode(null)),
      ),
    [scope, codec],
  );
  const [fallback, setFallback] = useState(() => ({
    scope,
    codec,
    encoded: initial,
  }));
  const scopedFallback =
    fallback.scope === scope && fallback.codec === codec
      ? fallback.encoded
      : initial;
  // Reset before committing the new scope, avoiding an effect-driven frame of old preferences.
  if (fallback.scope !== scope || fallback.codec !== codec)
    setFallback({ scope, codec, encoded: initial });
  const snapshot = useBrowserQuery(event);
  const encodedFrom = (entry: ReturnType<typeof getCommittedBrowserQuery>) => {
    // Server rendering and the hydration pass share feature defaults. Local
    // preferences are applied only after the external store reads the browser.
    if (entry === getServerBrowserQuery()) return null;
    const query = new URLSearchParams(entry.search);
    const owner = entry.state?.[scopeField];
    return owner === scope || (!owner && query.has(parameter))
      ? query.get(parameter)
      : scopedFallback;
  };
  const encoded = encodedFrom(snapshot);
  const state = useMemo(() => codec.decode(encoded), [codec, encoded]);
  const write = useQueryHistoryWriter(scope);
  function update(patch: Partial<T>) {
    const entry = getCommittedBrowserQuery();
    const current = codec.decode(encodedFrom(entry));
    const next = { ...current, ...patch };
    const serialized = codec.encode(next);
    if (serialized === codec.encode(current)) return;
    const changeQuery = (value: string | null) => (query: URLSearchParams) => {
      if (value) query.set(parameter, value);
      else query.delete(parameter);
    };
    // Back restores the actual starting view even when it originally came from preferences.
    if (entry.state?.[scopeField] !== scope)
      updateBrowserQuery(changeQuery(codec.encode(current)), {
        metadata: { [scopeField]: scope },
        event,
      });
    setFallback({ scope, codec, encoded: serialized });
    preferences.write(scope, codec.writePreference(next));
    write(changeQuery(serialized), {
      metadata: { [scopeField]: scope },
      event,
      typing: Object.keys(patch).length === 1 && patch.search !== undefined,
    });
  }
  return { state, update };
}
