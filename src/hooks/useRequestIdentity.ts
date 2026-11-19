"use client";
import { useRef } from "react";
import { drafts } from "@/lib/browser/storage";
import { createRequestIdentityRegistry } from "./requestIdentityRegistry";

/**
 * durable: also stored per scope, so a remount recovers the ID.
 * ephemeral: in memory only; a remount mints a new ID.
 */
export type RequestIdentityPolicy = "durable" | "ephemeral";
/** The server's IDEMPOTENCY_RETENTION_MS: an older ID can no longer replay. */
export const REQUEST_ID_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[0-9a-f-]{36}$/;
type Requests = Record<string, { readonly id: string; readonly at: number }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** undefined means unreadable, never an empty/fresh recovery document. */
function readRequests(scope: string): Requests | undefined {
  const now = Date.now();
  return drafts.read(
    `fg-requests:${scope}`,
    (value, present): Requests | undefined => {
      if (!present) return {};
      if (!isRecord(value)) return undefined;
      // Version 1 keeps IDs in `requests` and mint times in `minted`; an
      // unversioned object is a pre-pilot flat map. Other versions are unknown.
      const versioned = "version" in value;
      if (versioned && value.version !== 1) return undefined;
      const entries = versioned ? value.requests : value;
      if (!isRecord(entries)) return undefined;
      const minted = versioned && isRecord(value.minted) ? value.minted : {};
      const requests: Requests = {};
      for (const [key, id] of Object.entries(entries)) {
        if (typeof id !== "string" || !ID_PATTERN.test(id)) continue;
        // An untimed entry starts its retention when first read.
        const at = typeof minted[key] === "number" ? minted[key] : now;
        if (now - at < REQUEST_ID_RETENTION_MS) requests[key] = { id, at };
      }
      return requests;
    },
    undefined,
  );
}

function writeRequests(scope: string, requests: Requests) {
  const keys = Object.keys(requests);
  if (!keys.length) return drafts.remove(`fg-requests:${scope}`);
  return drafts.write(`fg-requests:${scope}`, {
    version: 1,
    requests: Object.fromEntries(keys.map((key) => [key, requests[key]!.id])),
    minted: Object.fromEntries(keys.map((key) => [key, requests[key]!.at])),
  });
}

type ScopeState = {
  readonly scope: string | undefined;
  readonly registry: ReturnType<typeof createRequestIdentityRegistry>;
  /** Stored keys this mount dispatched; success retires only these. */
  readonly used: Set<string>;
};

export function useRequestIdentity(scope?: string) {
  const state = useRef<ScopeState | null>(null);
  const current = () => {
    if (!state.current || state.current.scope !== scope)
      state.current = {
        scope,
        registry: createRequestIdentityRegistry(),
        used: new Set(),
      };
    return state.current;
  };
  const request = (key: string, policy: RequestIdentityPolicy = "durable") => {
    const { registry, used } = current();
    if (policy === "ephemeral" || !scope) return registry.request(key);
    used.add(key);
    const saved = readRequests(scope);
    const stored = saved && Object.hasOwn(saved, key) ? saved[key] : undefined;
    // A live ID is pinned for this mount; storage only recovers after remount.
    const id = registry.request(key, { read: () => stored?.id ?? null });
    if (saved && stored?.id !== id)
      writeRequests(scope, { ...saved, [key]: { id, at: Date.now() } });
    return id;
  };
  /** Retire one key, or after success every key this mount dispatched. */
  const clearRequests = (key?: string) => {
    const { registry, used } = current();
    const retired = key === undefined ? [...used] : [key];
    if (key === undefined) registry.clear();
    else registry.forget(key);
    for (const entry of retired) used.delete(entry);
    if (!scope) return false;
    const saved = readRequests(scope);
    // Success may retire an unreadable document; clearing one key may not.
    if (saved === undefined)
      return key === undefined && drafts.remove(`fg-requests:${scope}`);
    if (!retired.some((entry) => Object.hasOwn(saved, entry))) return true;
    for (const entry of retired) delete saved[entry];
    return writeRequests(scope, saved);
  };
  return { request, clearRequests };
}
