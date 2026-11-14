"use client";
import { useRef } from "react";
import { drafts } from "@/lib/browser/storage";
import { createRequestIdentityRegistry } from "./requestIdentityRegistry";

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
  const request = (
    key: string,
    policy: RequestIdentityPolicy = "ephemeral",
  ) => {
    const current = currentRequests();
    const saved = scope ? readRequests(scope) : undefined;
    // Stored durable identities win, including another tab's persisted ID.
    if (policy === "durable" && saved && Object.hasOwn(saved, key))
      current.registry.forget(key);
    const id = current.registry.request(key, {
      read: () => (saved && Object.hasOwn(saved, key) ? saved[key]! : null),
    });
    if (scope && saved !== undefined && saved[key] !== id) {
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
      if (saved === undefined) {
        current.registry.forget(key);
        return false;
      }
      delete saved[key];
      const cleared = Object.keys(saved).length
        ? drafts.write(`fg-requests:${scope}`, { version: 1, requests: saved })
        : drafts.remove(`fg-requests:${scope}`);
      current.registry.forget(key);
      return cleared;
    }
    // Whole-scope success may retire even an unreadable recovery document.
    const removed = !!scope && drafts.remove(`fg-requests:${scope}`);
    current.registry.clear();
    return removed;
  };
  return { request, clearRequests };
}
