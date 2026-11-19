"use client";
import { useRef } from "react";
import { drafts } from "@/lib/browser/storage";
import { createRequestIdentityRegistry } from "./requestIdentityRegistry";

/**
 * durable: persisted per scope, so a remount or another tab reuses the ID.
 * ephemeral: in memory only; a remount mints a new ID.
 */
export type RequestIdentityPolicy = "durable" | "ephemeral";
const ID_PATTERN = /^[0-9a-f-]{36}$/;
type Requests = Record<string, string>;

/** undefined means unreadable, never an empty/fresh recovery document. */
function readRequests(scope: string): Requests | undefined {
  return drafts.read(
    `fg-requests:${scope}`,
    (value, present): Requests | undefined => {
      if (!present) return {};
      if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
      const record = value as Record<string, unknown>;
      const entries = record.version === 1 ? record.requests : record;
      if (!entries || typeof entries !== "object" || Array.isArray(entries))
        return undefined;
      return Object.fromEntries(
        Object.entries(entries).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" && ID_PATTERN.test(entry[1]),
        ),
      );
    },
    undefined,
  );
}
export function useRequestIdentity(scope?: string) {
  const requests = useRef({
    scope,
    registry: createRequestIdentityRegistry(),
  });
  const currentRequests = () => {
    if (requests.current.scope !== scope)
      requests.current = {
        scope,
        registry: createRequestIdentityRegistry(),
      };
    return requests.current;
  };
  const request = (key: string, policy: RequestIdentityPolicy = "durable") => {
    const current = currentRequests();
    if (policy === "ephemeral" || !scope) return current.registry.request(key);
    const saved = readRequests(scope);
    const stored = saved && Object.hasOwn(saved, key) ? saved[key]! : null;
    // Stored identities win, including another tab's persisted ID.
    if (stored) current.registry.forget(key);
    const id = current.registry.request(key, { read: () => stored });
    if (saved !== undefined && stored !== id) {
      drafts.write(`fg-requests:${scope}`, {
        version: 1,
        requests: { ...saved, [key]: id },
      });
    }
    return id;
  };
  const clearRequests = (key?: string) => {
    const current = currentRequests();
    if (key !== undefined) {
      const saved = scope ? readRequests(scope) : undefined;
      current.registry.forget(key);
      if (saved === undefined) return false;
      // Ephemeral keys and already-cleared keys leave storage untouched.
      if (!Object.hasOwn(saved, key)) return true;
      delete saved[key];
      const cleared = Object.keys(saved).length
        ? drafts.write(`fg-requests:${scope}`, { version: 1, requests: saved })
        : drafts.remove(`fg-requests:${scope}`);
      return cleared;
    }
    // Whole-scope success may retire even an unreadable recovery document.
    const removed = !!scope && drafts.remove(`fg-requests:${scope}`);
    current.registry.clear();
    return removed;
  };
  return { request, clearRequests };
}
