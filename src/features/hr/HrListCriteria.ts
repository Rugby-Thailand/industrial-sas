"use client";

/**
 * URL-backed criteria for HR record lists. Kept apart from the paging hook
 * so record pickers inside forms do not depend on page navigation.
 */
import { useEffect, useRef, useState } from "react";

import { useQueryHistoryWriter } from "@/hooks/useQueryHistoryWriter";
import { updateHistoryMetadata } from "@/lib/browser/history";
import { useQueryParams, useUrlBackedState } from "@/lib/deepLink";

const ENTRY_KEY = "hrListEntry";
const newEntry = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
function entryOf(): string | null {
  if (typeof window === "undefined") return null;
  const marker: unknown = window.history.state?.[ENTRY_KEY];
  return typeof marker === "string" ? marker : null;
}

/**
 * List criteria in the page URL (`?q=…&site=…`), so reload, Back/Forward
 * and returning from a detail restore them. Unknown parameters (an open
 * editor, a selection) are preserved; a typing burst shares one history
 * entry, other changes add one.
 *
 * The third value names the history entry of the last criteria change. Pass
 * it to the paging hook: a change made here always starts at page 1 (even
 * when it returns to earlier criteria), while Back/Forward to an entry
 * restores that entry's page. Entries pushed by the router for a selection
 * or an editor carry no marker and keep the list's current one.
 */
export function useHrListCriteria<Keys extends string>(
  defaults: Readonly<Record<Keys, string>>,
  scope: string,
): readonly [
  Readonly<Record<Keys, string>>,
  (patch: Partial<Record<Keys, string>>, typing?: boolean) => void,
  string | null,
] {
  const params = useQueryParams();
  const keys = Object.keys(defaults) as Keys[];
  const fromUrl = Object.fromEntries(
    keys.map((key) => [key, params.get(key) ?? defaults[key]]),
  ) as Record<Keys, string>;
  const [value, setValue] = useUrlBackedState(JSON.stringify(fromUrl), fromUrl);
  const write = useQueryHistoryWriter(`hr-list:${scope}`);
  const [sticky, setSticky] = useState<string | null>(null);
  // The marker for an entry that has none yet (the list's first entry).
  const [own] = useState(newEntry);
  const current = entryOf();
  if (current !== null && current !== sticky) setSticky(current);
  useEffect(() => {
    // Mark the entry the list first opened in, so Back returns to its page.
    if (entryOf() !== null) return;
    updateHistoryMetadata((state) => {
      state[ENTRY_KEY] = own;
    });
  }, [own]);
  const update = (patch: Partial<Record<Keys, string>>, typing = false) => {
    const next = { ...value, ...patch };
    if (keys.every((key) => next[key] === value[key])) return;
    setValue(next);
    const entry = newEntry();
    setSticky(entry);
    write(
      (query) => {
        for (const key of keys) {
          if (next[key] === defaults[key]) query.delete(key);
          else query.set(key, next[key]);
        }
      },
      { metadata: { [ENTRY_KEY]: entry }, event: "hr-list-criteria", typing },
    );
  };
  return [value, update, current ?? sticky ?? own] as const;
}

/**
 * The query string without list criteria, for navigation tokens (deep-link
 * focus, URL-backed panels) that must not re-run while someone types.
 */
export function navigationKey(
  params: { toString(): string },
  listKeys: readonly string[],
): string {
  const query = new URLSearchParams(params.toString());
  for (const key of listKeys) query.delete(key);
  return query.toString();
}

/** List position metadata a router navigation would otherwise drop. */
const CARRIED_KEYS = [
  ENTRY_KEY,
  "cataloguePaginationScopes",
  "cataloguePagination",
  "hrCursorStacks",
  "hrLocalPages",
] as const;

/**
 * Carry the list's position metadata across a router push/replace (which
 * starts the new history entry without it), so reloading an editor URL, or
 * the list after Close, keeps the list's page. Call `carry(href)` from the
 * navigation's own callback, so a navigation the draft guard cancels
 * carries nothing; the snapshot is applied once the router has committed
 * exactly that URL.
 */
export function useCarriedListState(): (href: string) => void {
  const params = useQueryParams();
  const query = params.toString();
  const pending = useRef<{
    readonly href: string;
    readonly state: Readonly<Record<string, unknown>>;
  } | null>(null);
  useEffect(() => {
    const carried = pending.current;
    if (carried === null) return;
    const target = new URL(carried.href, window.location.origin);
    if (
      target.pathname.replace(/\/$/, "") !==
        window.location.pathname
          .replace(/\/$/, "")
          .replace(/^\/[a-z]{2}(?=\/)/, "") ||
      target.search !== window.location.search
    )
      return;
    pending.current = null;
    updateHistoryMetadata((state) => {
      for (const [key, value] of Object.entries(carried.state))
        if (state[key] === undefined) state[key] = value;
    });
  }, [query]);
  return (href) => {
    const current: unknown = window.history.state;
    const state: Record<string, unknown> = {};
    if (current && typeof current === "object")
      for (const key of CARRIED_KEYS) {
        const value = (current as Record<string, unknown>)[key];
        if (value !== undefined) state[key] = value;
      }
    pending.current = { href, state };
  };
}
