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
      if (record.version === 1 && Object.keys(record).length !== 2)
        return undefined;
      const entries =
        record.version === 1 && "requests" in record ? record.requests : record;
      if (
        !entries ||
        typeof entries !== "object" ||
        Array.isArray(entries) ||
        !Object.values(entries).every(
          (id) => typeof id === "string" && ID_PATTERN.test(id),
        )
      )
        return undefined;
      return entries as Requests;
    },
    undefined,
  );
}
export function useRequestIdentity(scope?: string) {
  const requests = useRef({
    scope,
    registry: createRequestIdentityRegistry(),
    durable: false,
  });
  const currentRequests = () => {
    if (requests.current.scope !== scope)
      requests.current = {
        scope,
        registry: createRequestIdentityRegistry(),
        durable: false,
      };
    return requests.current;
  };
  const request = (
    key: string,
    policy: RequestIdentityPolicy = "ephemeral",
  ) => {
    const current = currentRequests();
    const saved = scope ? readRequests(scope) : undefined;
    if (policy === "durable") {
      current.durable = true;
      if (!scope || saved === undefined)
        throw new Error("REQUEST_IDENTITY_UNAVAILABLE");
      // The stored identity wins over local memory (including another tab's
      // completed persistence). Reading it is sufficient even at quota.
      if (Object.hasOwn(saved, key)) current.registry.forget(key);
    }
    const id = current.registry.request(key, {
      read: () => (saved && Object.hasOwn(saved, key) ? saved[key]! : null),
    });
    if (scope && saved !== undefined && saved[key] !== id) {
      const persisted = drafts.write(`fg-requests:${scope}`, {
        version: 1,
        requests: { ...saved, [key]: id },
      });
      if (policy === "durable" && !persisted)
        throw new Error("REQUEST_IDENTITY_UNAVAILABLE");
    }
    return id;
  };
  const clearRequests = () => {
    const current = currentRequests();
    // Do not erase a document we cannot decode, or forget a durable ID when
    // removal failed. A remount must see the same recovery identity.
    const removed =
      !!scope &&
      readRequests(scope) !== undefined &&
      drafts.remove(`fg-requests:${scope}`);
    if (removed || !current.durable) current.registry.clear();
    return removed;
  };
  return { request, clearRequests };
}
