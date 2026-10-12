"use client";
import { useRef } from "react";
import { drafts } from "@/lib/browser/storage";
import { createRequestIdentityRegistry } from "./requestIdentityRegistry";

function readRequests(scope: string) {
  return drafts.read(
    `fg-requests:${scope}`,
    (value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {},
    {},
  );
}
export function useRequestIdentity(scope?: string) {
  const requests = useRef({ scope, registry: createRequestIdentityRegistry() });
  const currentRequests = () => {
    if (requests.current.scope !== scope)
      requests.current = { scope, registry: createRequestIdentityRegistry() };
    return requests.current.registry;
  };
  const request = (key: string) => {
    const id = currentRequests().request(key, {
      read: () => {
        const saved = scope ? readRequests(scope)[key] : undefined;
        return typeof saved === "string" && /^[0-9a-f-]{36}$/.test(saved)
          ? saved
          : null;
      },
    });
    if (scope)
      drafts.write(`fg-requests:${scope}`, {
        ...readRequests(scope),
        [key]: id,
      });
    return id;
  };
  const clearRequests = () => {
    currentRequests().clear();
    if (scope) drafts.remove(`fg-requests:${scope}`);
  };
  return { request, clearRequests };
}
