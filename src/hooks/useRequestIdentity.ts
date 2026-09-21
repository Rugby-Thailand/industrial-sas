"use client";
import { useRef } from "react";
import { drafts } from "@/lib/browser/storage";

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
  const requests = useRef({ scope, values: new Map<string, string>() });
  const currentRequests = () => {
    if (requests.current.scope !== scope)
      requests.current = { scope, values: new Map() };
    return requests.current.values;
  };
  const request = (key: string) => {
    let id = currentRequests().get(key);
    if (!id && scope) {
      const saved = readRequests(scope)[key];
      if (typeof saved === "string" && /^[0-9a-f-]{36}$/.test(saved))
        id = saved;
    }
    if (!id) id = crypto.randomUUID();
    currentRequests().set(key, id);
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
