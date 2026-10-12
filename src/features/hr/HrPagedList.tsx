"use client";

/**
 * Cursor-paged HR lists: one hook binds an HR page query to the shared
 * cursor history (`useCursorPagination`) and scan continuation
 * (`useCatalogueSync`), and one pager presents it with the page sizes the
 * HR endpoints accept (20 or 50; never the generic 100).
 *
 * Positions live in browser history metadata, scoped to the HR identity,
 * surface and criteria, so detail → Back and browser Back/Forward return to
 * the same page, while any criteria or page-size change starts at page 1.
 * Records always come from the live, authorized query.
 */
import { useQuery } from "convex/react";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { PageSizeSelect } from "@/components/system/PageSizeSelect";
import { PaginationFooter } from "@/components/system/PaginationFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCatalogueSync,
  type CatalogueOutcome,
} from "@/hooks/useCatalogueSync";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { updateHistoryMetadata } from "@/lib/browser/history";
import { useScanRecovery } from "@/hooks/useScanRecovery";

export const HR_PAGE_SIZES = [20, 50] as const;
export type HrPageSize = (typeof HR_PAGE_SIZES)[number];

type PagingArgs = "pageSize" | "cursor" | "scanCursor";
type PageQuery = FunctionReference<"query">;
type Outcome<Ref extends PageQuery> = FunctionReturnType<Ref>;
type ValueOf<O> = O extends { readonly ok: true; readonly value: infer V }
  ? V
  : never;
type Value<Ref extends PageQuery> = ValueOf<Outcome<Ref>>;
/** The successful page answer of a paged HR query. */
export type HrPageValue<Ref extends PageQuery> = Extract<
  Value<Ref>,
  { readonly ok: true; readonly status: string }
>;
export type HrPageRow<Ref extends PageQuery> =
  HrPageValue<Ref> extends { readonly page: readonly (infer Row)[] }
    ? Row
    : never;

/** Why a page could not be completed automatically. */
export type HrInterruption = "reset" | "stalled" | "paused";

export type HrPagedView<Ref extends PageQuery> =
  | { readonly kind: "loading"; readonly searching: boolean }
  | { readonly kind: "denied"; readonly requestId: string }
  | { readonly kind: "refused"; readonly code: string }
  | {
      /**
       * The page cannot continue on its own: its position is no longer valid
       * after the one automatic return to page 1 (`reset`), or a search step
       * did not advance (`stalled`), or the search used its automatic budget
       * (`paused`). No earlier rows are shown; `recover` starts this list
       * again from page 1 with a fresh request, `resume` keeps searching.
       */
      readonly kind: "interrupted";
      readonly reason: HrInterruption;
      readonly recover: () => void;
      readonly resume?: () => void;
    }
  | {
      readonly kind: "ready";
      readonly value: HrPageValue<Ref>;
      readonly rows: readonly HrPageRow<Ref>[];
      /**
       * Rows of the previous page shown while the next one loads. They are
       * inert: row actions must not act on them (see `HrPagedState`).
       */
      readonly updating: boolean;
    };

export interface HrPaging {
  readonly page: number;
  readonly pageSize: HrPageSize;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly loading: boolean;
  /** The page is interrupted; First and the page size stay usable. */
  readonly interrupted: boolean;
  readonly historyTruncated: boolean;
  readonly previous: () => void;
  readonly next: () => void;
  /** Page 1 with a fresh request (also the recovery of an interruption). */
  readonly first: () => void;
  readonly setPageSize: (size: HrPageSize) => void;
}

/**
 * Run a paged HR query. `args` are the criteria (without paging fields);
 * "skip" waits. Every argument is part of the position's identity.
 *
 * Scan steps are followed automatically through `useScanRecovery` (shared
 * with the other bounded-scan lists): a non-advancing step stops as
 * `stalled`, a long search pauses for the user, and a retry sends a new
 * `attempt` so the request is really made again. A cursor the server no
 * longer accepts returns to page 1 once automatically (`useCatalogueSync`);
 * if that fails too the list is `interrupted` with an explicit recovery.
 */
export function useHrPagedQuery<Ref extends PageQuery>(
  reference: Ref,
  args: Omit<FunctionArgs<Ref>, PagingArgs> | "skip",
  surface: string,
  /** The history entry of URL criteria (`useHrListCriteria`), if any. */
  entry: string | null = null,
): { readonly view: HrPagedView<Ref>; readonly paging: HrPaging } {
  const access = useHrAccess();
  const scope = `hr:${surface}:${access.identityKey ?? "anonymous"}`;
  const criteria = args === "skip" ? null : { args, entry };
  const paging = useCursorPagination({ scope, criteria });
  const pageSize: HrPageSize = paging.pageSize === 50 ? 50 : 20;
  const fingerprint = JSON.stringify([scope, criteria, pageSize]);
  const recovery = useScanRecovery(
    JSON.stringify([fingerprint, paging.cursor]),
  );
  const outcome = useQuery(
    reference,
    (args === "skip"
      ? "skip"
      : {
          ...args,
          pageSize,
          ...(paging.cursor ? { cursor: paging.cursor } : {}),
          ...(recovery.cursor ? { scanCursor: recovery.cursor } : {}),
          ...(recovery.attempt ? { attempt: recovery.attempt } : {}),
        }) as never,
  ) as
    | undefined
    | { ok: false; requestId: string }
    | {
        ok: true;
        value: {
          ok: boolean;
          status?: string;
          code?: string;
          scanCursor?: string;
        };
      };
  const sync = useMemo<CatalogueOutcome | undefined>(
    () =>
      outcome?.ok && outcome.value.ok
        ? ({ ok: true, value: outcome.value } as CatalogueOutcome)
        : undefined,
    [outcome],
  );
  const tracked = recovery.track(sync);
  const status =
    outcome?.ok && outcome.value.ok ? outcome.value.status : undefined;

  // One automatic return to a fresh page 1 when the server no longer accepts
  // the position (`reset`), owned here rather than by `useCatalogueSync`, so
  // a second reset is visible as terminal instead of loading forever. Each
  // automatic or explicit restart gets a request identity never used before
  // for these criteria (`recovery.key` includes the logical cursor and the
  // attempt), so "the same reset again" is recognisable.
  const hasPosition = Boolean(paging.cursor || recovery.cursor);
  const requestKey = JSON.stringify([recovery.key, recovery.cursor ?? null]);
  const [auto, setAuto] = useState<{ fp: string; at: string } | null>(null);
  const spent = auto?.fp === fingerprint ? auto : null;
  let autoAt = spent?.at ?? null;
  if (status === "ready" && spent !== null) setAuto(null);
  else if (status === "reset" && hasPosition && spent === null) {
    autoAt = requestKey;
    setAuto({ fp: fingerprint, at: requestKey });
  }
  const autoPending = status === "reset" && autoAt === requestKey;
  const restarted = useRef<string | null>(null);
  useEffect(() => {
    if (!autoPending) {
      restarted.current = null;
      return;
    }
    if (restarted.current === requestKey) return;
    restarted.current = requestKey;
    // A logical position returns to page 1; a page-1 scan restarts with a
    // fresh request.
    if (paging.cursor) paging.reset();
    else recovery.retry();
  }, [autoPending, requestKey, paging, recovery]);
  useCatalogueSync({
    // Resets are handled above; scans and empty-last-page recovery here.
    outcome:
      status === "reset"
        ? undefined
        : (tracked.outcome as CatalogueOutcome | undefined),
    continuation: tracked.continuation,
    paging,
    resetKey: fingerprint,
  });

  const interruption: HrInterruption | null =
    status === "reset" && !autoPending
      ? "reset"
      : tracked.stalled
        ? "stalled"
        : tracked.paused
          ? "paused"
          : null;
  const recover = () => {
    // A fresh first page: new logical position when there is one, and a new
    // request identity either way.
    if (paging.cursor) paging.reset();
    else recovery.retry();
  };

  const current =
    status === "ready" && outcome?.ok
      ? (outcome.value as unknown as HrPageValue<Ref> & {
          readonly page: readonly HrPageRow<Ref>[];
          readonly isDone: boolean;
          readonly continueCursor: string;
        })
      : null;
  // Keep the last page of the same criteria on screen while the next loads.
  const [shown, setShown] = useState<{
    key: string;
    value: NonNullable<typeof current>;
  } | null>(null);
  if (
    current !== null &&
    shown?.value !== current &&
    (shown?.key !== fingerprint ||
      JSON.stringify(shown.value) !== JSON.stringify(current))
  )
    setShown({ key: fingerprint, value: current });
  const retained = current ?? (shown?.key === fingerprint ? shown.value : null);

  let view: HrPagedView<Ref>;
  if (outcome?.ok === false)
    view = { kind: "denied", requestId: outcome.requestId };
  else if (outcome?.ok && !outcome.value.ok)
    view = { kind: "refused", code: outcome.value.code ?? "UNKNOWN" };
  else if (interruption !== null)
    view = {
      kind: "interrupted",
      reason: interruption,
      recover,
      ...(interruption === "paused" ? { resume: recovery.resume } : {}),
    };
  else if (retained !== null)
    view = {
      kind: "ready",
      value: retained,
      rows: retained.page,
      updating: current === null,
    };
  else
    view = {
      kind: "loading",
      searching: status === "scanning",
    };

  const interrupted = interruption !== null;
  const loading = current === null && !interrupted;
  return {
    view,
    paging: {
      page: paging.page,
      pageSize,
      canPrevious: paging.canPrevious,
      canNext: current !== null && !current.isDone,
      loading,
      interrupted,
      historyTruncated: paging.historyTruncated,
      previous: paging.previous,
      next: () => {
        if (current !== null && !current.isDone)
          paging.next(current.continueCursor);
      },
      first: recover,
      setPageSize: paging.setPageSize,
    },
  };
}

/** Shared pager presentation for HR lists (20 or 50 per page). */
export function HrPager({
  paging,
  label,
}: {
  readonly paging: HrPaging;
  readonly label: string;
}) {
  const t = useTranslations("Hr.pager");
  // A single complete page needs no controls.
  if (paging.page === 1 && !paging.canNext && !paging.loading) return null;
  // First is offered when Previous cannot reach page 1 (bounded history) or
  // the page is interrupted.
  const offerFirst =
    paging.page > 1 && (paging.historyTruncated || paging.interrupted);
  return (
    <PaginationFooter
      label={label}
      pageSizeControl={
        <PageSizeSelect
          label={t("perPage")}
          value={paging.pageSize}
          sizes={HR_PAGE_SIZES}
          onValueChange={paging.setPageSize}
          disabled={paging.loading}
        />
      }
      status={t(
        paging.loading
          ? "pageLoading"
          : paging.interrupted
            ? "pageInterrupted"
            : "page",
        { page: paging.page },
      )}
      previousLabel={t("previous")}
      nextLabel={t("next")}
      canPrevious={paging.canPrevious}
      canNext={paging.canNext}
      loading={paging.loading}
      onPrevious={paging.previous}
      onNext={paging.next}
      firstAction={
        offerFirst ? (
          <Button
            type="button"
            variant="outline"
            disabled={paging.loading}
            onClick={paging.first}
          >
            {t("first")}
          </Button>
        ) : null
      }
    />
  );
}

/** Busy state passed to row renderers: actions must be disabled while true. */
export interface HrRowState {
  readonly busy: boolean;
}

/**
 * Loading, denial, refusal and interruption for a paged list; `children`
 * renders rows. Rows of the previous page stay visible while the next page
 * loads, so the list keeps its footprint, but that subtree is `inert` and
 * `busy` is passed to the renderer so row actions are disabled too.
 */
export function HrPagedState<Ref extends PageQuery>({
  view,
  refused,
  children,
}: {
  readonly view: HrPagedView<Ref>;
  readonly refused: (code: string) => ReactNode;
  readonly children: (
    value: HrPageValue<Ref>,
    rows: readonly HrPageRow<Ref>[],
    state: HrRowState,
  ) => ReactNode;
}) {
  const t = useTranslations("Hr.pager");
  if (view.kind === "denied")
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: view.requestId }}
      />
    );
  if (view.kind === "refused") return <>{refused(view.code)}</>;
  if (view.kind === "interrupted") return <HrInterrupted view={view} />;
  if (view.kind === "loading")
    return (
      <div
        role="status"
        aria-busy="true"
        className="space-y-2 rounded-lg border border-border bg-surface p-4"
      >
        <span className="text-sm font-semibold text-muted">
          {t(view.searching ? "searching" : "loading")}
        </span>
        <div aria-hidden="true" className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      </div>
    );
  return (
    <div
      aria-busy={view.updating}
      inert={view.updating}
      data-testid={view.updating ? "hr-paged-updating" : undefined}
      className={view.updating ? "opacity-60 transition-opacity" : undefined}
    >
      {children(view.value, view.rows, { busy: view.updating })}
    </div>
  );
}

/** The explicit recovery of an interrupted page. */
export function HrInterrupted({
  view,
  compact = false,
}: {
  readonly view: Extract<HrPagedView<PageQuery>, { kind: "interrupted" }>;
  readonly compact?: boolean;
}) {
  const t = useTranslations("Hr.pager");
  return (
    <div
      role="alert"
      className={
        compact
          ? "space-y-2 text-sm"
          : "space-y-3 rounded-lg border border-border bg-surface p-4"
      }
      data-testid="hr-paged-interrupted"
    >
      <p className="text-sm font-semibold text-text">
        {t(`interrupted.${view.reason}`)}
      </p>
      <div className="flex flex-wrap gap-2">
        {view.resume ? (
          <Button type="button" onClick={view.resume}>
            {t("keepSearching")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={view.resume ? "outline" : "default"}
          onClick={view.recover}
        >
          {t("startOver")}
        </Button>
      </div>
    </div>
  );
}

/**
 * A list search box that reports its text once typing settles (250 ms). The
 * settled value comes from the caller (the URL), so Back restores the text.
 */
export function HrSearchField({
  id,
  label,
  value,
  onSettled,
  placeholder,
  className,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onSettled: (value: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
}) {
  const [state, setState] = useState({ external: value, text: value });
  let text = state.text;
  if (state.external !== value) {
    // A different settled value (Back, a cleared filter) replaces the text
    // unless it is the text the user is still typing.
    text = value === state.text.trim() ? state.text : value;
    setState({ external: value, text });
  }
  const settle = useRef(onSettled);
  useEffect(() => {
    settle.current = onSettled;
  });
  useEffect(() => {
    if (text.trim() === value) return;
    const timer = window.setTimeout(() => settle.current(text.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [text, value]);
  return (
    <div className={className ?? "grid w-full gap-2 sm:w-64"}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="search"
        value={text}
        maxLength={100}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) =>
          setState({ external: value, text: event.target.value })
        }
      />
    </div>
  );
}

type LocalPosition = { readonly page: number; readonly size: HrPageSize };
const LOCAL_KEY = "hrLocalPages";
const FIRST: LocalPosition = { page: 0, size: 20 };

function savedPosition(scope: string): LocalPosition {
  if (typeof window === "undefined") return FIRST;
  const saved: unknown = window.history.state?.[LOCAL_KEY]?.[scope];
  if (!saved || typeof saved !== "object") return FIRST;
  const { page, size } = saved as Partial<LocalPosition>;
  return Number.isSafeInteger(page) &&
    (page ?? -1) >= 0 &&
    (size === 20 || size === 50)
    ? { page: page!, size }
    : FIRST;
}

/**
 * Pages of a complete, contractually bounded list that is already loaded
 * (for example every open day of a period of at most 50 employees × 31
 * days). Paging only limits what is rendered; totals and actions keep
 * using the whole list. The position follows browser history, so returning
 * from a linked record restores it.
 */
export function useHrLocalPage(scope: string, count: number) {
  const [state, setState] = useState(() => ({
    scope,
    value: savedPosition(scope),
  }));
  let value = state.value;
  if (state.scope !== scope) {
    value = savedPosition(scope);
    setState({ scope, value });
  }
  useEffect(() => {
    const restore = () => setState({ scope, value: savedPosition(scope) });
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [scope]);
  const save = (next: LocalPosition) => {
    setState({ scope, value: next });
    updateHistoryMetadata((history) => {
      const pages =
        history[LOCAL_KEY] && typeof history[LOCAL_KEY] === "object"
          ? (history[LOCAL_KEY] as Record<string, unknown>)
          : {};
      history[LOCAL_KEY] = { ...pages, [scope]: next };
    });
  };
  const pages = Math.max(1, Math.ceil(count / value.size));
  const page = Math.min(value.page, pages - 1);
  return {
    page,
    pages,
    pageSize: value.size,
    start: page * value.size,
    end: Math.min(count, (page + 1) * value.size),
    count,
    previous: () => save({ ...value, page: Math.max(0, page - 1) }),
    next: () => save({ ...value, page: Math.min(pages - 1, page + 1) }),
    setPageSize: (size: HrPageSize) => save({ page: 0, size }),
  };
}

/** Pager for `useHrLocalPage`: exact counts are known, so they are shown. */
export function HrLocalPager({
  local,
  label,
}: {
  readonly local: ReturnType<typeof useHrLocalPage>;
  readonly label: string;
}) {
  const t = useTranslations("Hr.pager");
  if (local.count <= HR_PAGE_SIZES[0]) return null;
  return (
    <PaginationFooter
      label={label}
      pageSizeControl={
        <PageSizeSelect
          label={t("perPage")}
          value={local.pageSize}
          sizes={HR_PAGE_SIZES}
          onValueChange={local.setPageSize}
        />
      }
      status={t("range", {
        from: local.start + 1,
        to: local.end,
        count: local.count,
      })}
      previousLabel={t("previous")}
      nextLabel={t("next")}
      canPrevious={local.page > 0}
      canNext={local.page < local.pages - 1}
      onPrevious={local.previous}
      onNext={local.next}
    />
  );
}

const STACK_KEY = "hrCursorStacks";
const MAX_STACK = 500;

type SavedStack = { readonly cursors: string[]; readonly offset: number };
const EMPTY_STACK: SavedStack = { cursors: [], offset: 0 };

function savedStack(
  scope: string,
  fingerprint: string,
  maxStack: number,
): SavedStack {
  if (typeof window === "undefined") return EMPTY_STACK;
  const saved: unknown = window.history.state?.[STACK_KEY]?.[scope];
  if (!saved || typeof saved !== "object") return EMPTY_STACK;
  const { criteria, cursors, offset } = saved as {
    criteria?: unknown;
    cursors?: unknown;
    offset?: unknown;
  };
  const floor = offset === undefined ? 0 : offset;
  return criteria === fingerprint &&
    Array.isArray(cursors) &&
    cursors.length <= maxStack &&
    cursors.every((cursor) => typeof cursor === "string") &&
    Number.isSafeInteger(floor) &&
    (floor as number) >= 0 &&
    // A truncated stack always keeps its oldest retained page.
    (floor === 0 || cursors.length > 0)
    ? { cursors: cursors as string[], offset: floor as number }
    : EMPTY_STACK;
}

/** Navigation over a `useHrCursorStack`, honouring its truncation floor. */
export interface HrCursorNav {
  /** 1-based page number, counting pages dropped from the bounded stack. */
  readonly page: number;
  /**
   * Previous stops at the oldest retained page: once earlier cursors were
   * dropped it never jumps silently to page 1 (use `first`).
   */
  readonly canPrevious: boolean;
  /** Earlier pages were dropped; offer `first` explicitly. */
  readonly truncated: boolean;
  readonly previous: () => void;
  readonly next: (cursor: string) => void;
  readonly first: () => void;
}

/**
 * A drop-in for a `useState<string[]>` cursor stack (newer pages first)
 * whose position follows browser history, scoped to the HR identity, the
 * surface and its criteria. Opening a record and coming Back, or reloading,
 * returns to the same page; other criteria start at page 1.
 *
 * The stack keeps at most `maxStack` cursors. When older ones are dropped
 * the number dropped is kept as a floor: page numbers stay right, Previous
 * stops at the oldest retained page and `first` returns to page 1. Use the
 * returned `nav` for Previous/Next/First so the floor is respected.
 */
export function useHrCursorStack(
  surface: string,
  criteria: unknown = null,
  options: { readonly maxStack?: number } = {},
): readonly [
  readonly string[],
  (
    cursors:
      readonly string[] | ((previous: readonly string[]) => readonly string[]),
  ) => void,
  HrCursorNav,
] {
  const maxStack = Math.max(1, options.maxStack ?? MAX_STACK);
  const access = useHrAccess();
  const scope = `hr:${surface}:${access.identityKey ?? "anonymous"}`;
  const fingerprint = JSON.stringify(criteria ?? null);
  const key = `${scope}\n${fingerprint}`;
  const [state, setState] = useState(() => ({
    key,
    value: savedStack(scope, fingerprint, maxStack),
  }));
  let value = state.value;
  if (state.key !== key) {
    value = savedStack(scope, fingerprint, maxStack);
    setState({ key, value });
  }
  useEffect(() => {
    const restore = () =>
      setState({ key, value: savedStack(scope, fingerprint, maxStack) });
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [key, scope, fingerprint, maxStack]);
  const save = (next: SavedStack) => {
    setState({ key, value: next });
    updateHistoryMetadata((history) => {
      const stacks =
        history[STACK_KEY] && typeof history[STACK_KEY] === "object"
          ? (history[STACK_KEY] as Record<string, unknown>)
          : {};
      history[STACK_KEY] = {
        ...stacks,
        [scope]: { criteria: fingerprint, ...next },
      };
    });
  };
  const set = (
    update:
      readonly string[] | ((previous: readonly string[]) => readonly string[]),
  ) => {
    const next = typeof update === "function" ? update(value.cursors) : update;
    // An explicitly empty stack is page 1 (criteria change, First).
    if (next.length === 0) return save(EMPTY_STACK);
    const drop = Math.max(0, next.length - maxStack);
    save({ cursors: next.slice(drop), offset: value.offset + drop });
  };
  const floor = value.offset > 0 ? 1 : 0;
  const nav: HrCursorNav = {
    page: value.offset + value.cursors.length + 1,
    canPrevious: value.cursors.length > floor,
    truncated: value.offset > 0,
    previous: () => {
      if (value.cursors.length > floor)
        save({ ...value, cursors: value.cursors.slice(0, -1) });
    },
    next: (cursor) => {
      if (cursor) set([...value.cursors, cursor]);
    },
    first: () => save(EMPTY_STACK),
  };
  return [value.cursors, set, nav] as const;
}

/** The explicit return to page 1 of a truncated cursor stack. */
export function HrStackFirst({
  nav,
  guard = (action) => action(),
}: {
  readonly nav: HrCursorNav;
  /** Wraps the navigation, e.g. a draft guard. */
  readonly guard?: (action: () => void) => void;
}) {
  const t = useTranslations("Hr.pager");
  if (!nav.truncated) return null;
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => guard(nav.first)}
      data-testid="hr-stack-first"
    >
      {t("first")}
    </Button>
  );
}
