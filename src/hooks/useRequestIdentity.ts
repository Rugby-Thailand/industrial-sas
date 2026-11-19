"use client";
import { useRef } from "react";
import { drafts } from "@/lib/browser/storage";
import { createRequestIdentityRegistry } from "./requestIdentityRegistry";

/**
 * durable: also stored per scope, so a remount recovers the ID.
 * ephemeral: in memory only; a remount mints a new ID.
 */
export type RequestIdentityPolicy = "durable" | "ephemeral";
/**
 * Measured from the last dispatch. The server keeps a receipt for
 * IDEMPOTENCY_RETENTION_MS (30 days) from its commit, which follows dispatch;
 * the extra day covers a delayed commit. Keeping an ID longer is harmless.
 */
export const REQUEST_ID_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
/**
 * The document stays the pre-pilot flat `{ [command key]: id }` map, so tabs
 * still running an older bundle read and write it during a rollout. Mint
 * times live under one reserved entry that older bundles preserve and ignore.
 */
const MINTED = "@minted";
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
      const minted = isRecord(value[MINTED]) ? value[MINTED] : {};
      const requests: Requests = {};
      for (const [key, id] of Object.entries(value)) {
        if (typeof id !== "string" || !ID_PATTERN.test(id)) continue;
        // An entry an older bundle wrote counts as fresh until it is stamped.
        const at = typeof minted[key] === "number" ? minted[key] : now;
        if (now - at < REQUEST_ID_RETENTION_MS) requests[key] = { id, at };
      }
      return requests;
    },
    undefined,
  );
}

function writeRequests(scope: string, requests: Requests) {
  const entries = Object.entries(requests);
  if (!entries.length) return drafts.remove(`fg-requests:${scope}`);
  return drafts.write(`fg-requests:${scope}`, {
    ...Object.fromEntries(entries.map(([key, { id }]) => [key, id])),
    [MINTED]: Object.fromEntries(entries.map(([key, { at }]) => [key, at])),
  });
}

type ScopeState = {
  readonly scope: string | undefined;
  readonly registry: ReturnType<typeof createRequestIdentityRegistry>;
  /** Durable keys this mount dispatched, with the ID it sent. */
  readonly used: Map<string, string>;
};

export function useRequestIdentity(scope?: string) {
  const state = useRef<ScopeState | null>(null);
  const current = () => {
    if (!state.current || state.current.scope !== scope)
      state.current = {
        scope,
        registry: createRequestIdentityRegistry(),
        used: new Map(),
      };
    return state.current;
  };
  const request = (key: string, policy: RequestIdentityPolicy = "durable") => {
    const { registry, used } = current();
    if (policy === "ephemeral" || !scope) return registry.request(key);
    const saved = readRequests(scope);
    const stored = saved && Object.hasOwn(saved, key) ? saved[key] : undefined;
    // A live ID is pinned for this mount; storage only recovers after remount.
    const id = registry.request(key, { read: () => stored?.id ?? null });
    used.set(key, id);
    // Each dispatch restarts retention; another tab's ID for the key is kept.
    if (saved && (!stored || stored.id === id))
      writeRequests(scope, { ...saved, [key]: { id, at: Date.now() } });
    return id;
  };
  /**
   * Retire one key, or after success every key this mount dispatched. Storage
   * changes only for this mount's own durable IDs; ephemeral keys, IDs another
   * tab replaced and unreadable documents are left alone.
   */
  const clearRequests = (key?: string) => {
    const { registry, used } = current();
    const retired = [...used].filter(
      ([entry]) => key === undefined || entry === key,
    );
    if (key === undefined) registry.clear();
    else registry.forget(key);
    for (const [entry] of retired) used.delete(entry);
    if (!scope || !retired.length) return true;
    const saved = readRequests(scope);
    if (saved === undefined) return false;
    const owned = retired.filter(([entry, id]) => saved[entry]?.id === id);
    if (!owned.length) return true;
    for (const [entry] of owned) delete saved[entry];
    return writeRequests(scope, saved);
  };
  return { request, clearRequests };
}
