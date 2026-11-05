"use client";

import { Search, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Fragment,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  type DialogCompletionHandle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatBusinessDate } from "@/features/hr/format";
import { usePathname } from "@/i18n/navigation";
import {
  HR_CODES,
  hasNavigationPermission,
  type DestinationTarget,
} from "@/lib/navigation";
import type {
  IntentOutcome,
  PageSearchContext,
} from "@/lib/search/resolveIntent";
import { cn } from "@/lib/utils";

import type { SearchMode } from "./GlobalSearchProvider";
import { highlightParts } from "./highlight";
import {
  useRecordResults,
  useResultLabels,
  useShortcutResults,
  useStaticResults,
  type ResultGroup,
  type SearchResult,
} from "./results";
import { useAiSearch, type AiState } from "./useAiSearch";

/** Ordinary (non-AI) results of a typed query, in display order. */
const ORDINARY_GROUPS: readonly ResultGroup[] = ["PAGES", "RECORDS", "TASKS"];
const DEBOUNCE_MS = 250;

interface Section {
  readonly group: ResultGroup;
  readonly items: readonly SearchResult[];
  /** False: the group is named for assistive technology only. */
  readonly labelled: boolean;
}

/** The typed text after a short pause, held while an IME is composing. */
function useSettledText(text: string, composing: boolean): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setSettled(text), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [composing, text]);
  return text.trim() === "" ? "" : settled;
}

export function SearchDialog({
  completionRef,
  open,
  mode,
  aiAvailable,
  granted,
  pageContext,
  onOpenChange,
  onModeChange,
  onNavigate,
}: {
  /** Consumes this dialog's entry before a chosen destination is pushed. */
  readonly completionRef?: Ref<DialogCompletionHandle>;
  readonly open: boolean;
  readonly mode: SearchMode;
  readonly aiAvailable: boolean;
  readonly granted: readonly string[];
  readonly pageContext: PageSearchContext | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onModeChange: (mode: SearchMode) => void;
  readonly onNavigate: (target: DestinationTarget, trail: string) => boolean;
}) {
  // An accepted destination takes focus itself (a deep-link section), so
  // this close must not hand focus back to the opener after it. Escape, the
  // close button and a refused target leave the ordinary return in place.
  const navigated = useRef(false);
  const navigate = (target: DestinationTarget, trail: string) => {
    const accepted = onNavigate(target, trail);
    if (accepted) navigated.current = true;
    return accepted;
  };
  // Escape clears typed text first and closes only an empty search. Back is
  // not a key press: it still dismisses the dialog through its disclosure.
  const clearOnEscape = useRef<(() => boolean) | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      {...(completionRef === undefined ? {} : { completionRef })}
    >
      <DialogContent
        size="lg"
        showCloseButton={false}
        className="top-0 left-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 content-start gap-3 rounded-none p-3 sm:top-[10vh] sm:left-1/2 sm:h-auto sm:max-h-[min(42rem,80dvh)] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-xl sm:p-4"
        data-testid="global-search"
        // Focus the input here rather than with autoFocus: the dialog first
        // records the opener, so Escape returns focus to the trigger.
        onOpenAutoFocus={(event) => {
          navigated.current = false;
          const field = (
            event.currentTarget as HTMLElement | null
          )?.querySelector<HTMLInputElement>(
            '[data-testid="global-search-input"]',
          );
          if (field) {
            event.preventDefault();
            field.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          if (navigated.current) event.preventDefault();
          navigated.current = false;
        }}
        onEscapeKeyDown={(event) => {
          // An IME uses Escape to drop its candidate; the search stays put.
          if (event.isComposing || event.keyCode === 229)
            event.preventDefault();
          else if (clearOnEscape.current?.()) event.preventDefault();
        }}
      >
        {open ? (
          <SearchBody
            clearOnEscape={clearOnEscape}
            mode={mode}
            aiAvailable={aiAvailable}
            granted={granted}
            pageContext={pageContext}
            onModeChange={onModeChange}
            onNavigate={navigate}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SearchBody({
  clearOnEscape,
  mode,
  aiAvailable,
  granted,
  pageContext,
  onModeChange,
  onNavigate,
}: {
  /** Clears typed text for Escape; false when there is nothing to clear. */
  readonly clearOnEscape: RefObject<(() => boolean) | null>;
  readonly mode: SearchMode;
  readonly aiAvailable: boolean;
  readonly granted: readonly string[];
  readonly pageContext: PageSearchContext | null;
  readonly onModeChange: (mode: SearchMode) => void;
  readonly onNavigate: (target: DestinationTarget, trail: string) => boolean;
}) {
  const t = useTranslations("Search");
  const hr = useHrAccess();
  const labels = useResultLabels();
  const pathname = usePathname();
  const id = useId();
  const listId = `${id}-results`;
  const scopeId = `${id}-ai-scope`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const settled = useSettledText(query, composing);
  const today = hr.today ?? null;
  // Nothing typed: the list offers places to go and things to ask.
  const browsing = query.trim() === "";
  const canSearchPeople = hasNavigationPermission(
    [HR_CODES.review, HR_CODES.admin],
    granted,
    "ANY",
  );

  // The page context is shown and can be cleared; a new record re-offers it.
  const contextKey = pageContext === null ? "" : JSON.stringify(pageContext);
  const [clearedContext, setClearedContext] = useState<string | null>(null);
  const context =
    contextKey !== "" && clearedContext !== contextKey ? pageContext : null;

  const staticResults = useStaticResults(settled, granted);
  const records = useRecordResults(settled, granted, today, settled !== "");
  const shortcuts = useShortcutResults(granted, pathname);
  const examples = useExampleResults(granted, context);
  const ai = useAiSearch({
    query,
    granted,
    context,
    onNavigate: (target) => onNavigate(target, labels.targetTrail(target)),
  });
  const aiChoices = useMemo(
    () => aiResults(ai.state, labels.choiceResult),
    [ai.state, labels],
  );
  // While the AI works on (or has answered) this text, the ordinary results
  // below its answer are labelled as such, so neither is taken for the other.
  const aiActive = mode === "AI" && ai.state.status !== "IDLE";

  // Results belong to the settled text. While the input differs (typing,
  // before the pause) or an IME is composing, they are shown but cannot be
  // opened: Enter or a click must never open the previous query's record.
  const stale = composing || settled !== (browsing ? "" : query);
  const ordinary = useMemo(
    () =>
      ORDINARY_GROUPS.flatMap((group) =>
        [...staticResults, ...records.state.results].filter(
          (result) => result.group === group,
        ),
      ),
    [records.state.results, staticResults],
  );
  const canAsk =
    aiAvailable &&
    !composing &&
    query.trim().length >= 2 &&
    ai.state.status !== "RUNNING";
  const noResults =
    !browsing && ordinary.length === 0 && aiChoices.length === 0;
  const noMatch = noResults && !stale && !records.state.loading;
  // Whether the latest settled text matched nothing. It holds while the next
  // text is typed and searched, so the offer below and the Ask AI button do
  // not trade places on every keystroke.
  const [unmatched, setUnmatched] = useState(false);
  const outcome = browsing
    ? false
    : stale || records.state.loading
      ? unmatched
      : noMatch;
  if (outcome !== unmatched) setUnmatched(outcome);
  // Nothing matched: the typed text itself is offered to the AI, as the one
  // AI action in place of the button. Typed further, the offer stays (but
  // cannot be chosen until the results settle) until something matches.
  const offerAsk =
    outcome &&
    noResults &&
    aiAvailable &&
    query.trim().length >= 2 &&
    ai.state.status === "IDLE";
  const fallback: readonly SearchResult[] = offerAsk
    ? [
        {
          id: "ask-query",
          group: "ASK",
          title: t("askQuery", { query: query.trim() }),
          trail: "",
          target: null,
          ask: query,
        },
      ]
    : [];

  const goTo: Section = { group: "GOTO", items: shortcuts, labelled: true };
  const tryAsking: Section = {
    group: "ASK",
    items: aiAvailable ? examples : [],
    labelled: true,
  };
  const sections: readonly Section[] = browsing
    ? // Asked the AI and cleared the box: its examples come first.
      mode === "AI"
      ? [tryAsking, goTo]
      : [goTo, tryAsking]
    : [
        { group: "ASK", items: fallback, labelled: false },
        { group: "AI", items: aiChoices, labelled: true },
        ...ORDINARY_GROUPS.map((group) => ({
          group,
          items: ordinary.filter((result) => result.group === group),
          labelled: true,
        })),
      ];
  const shown = sections.filter((section) => section.items.length > 0);
  const results = shown.flatMap((section) => section.items);
  const enabled = stale
    ? []
    : results.filter(
        (result) => result.target !== null || result.ask !== undefined,
      );
  // The first openable result is active in normal search; in AI mode Enter
  // asks the AI until the user moves into the results.
  const [active, setActive] = useState<{ query: string; id: string | null }>({
    query: "",
    id: null,
  });
  const activeId =
    active.query === settled &&
    enabled.some((result) => result.id === active.id)
      ? active.id
      : mode === "AI"
        ? null
        : (enabled[0]?.id ?? null);
  const activeResult = enabled.find((result) => result.id === activeId);

  useEffect(() => {
    if (activeId === null) return;
    document
      .getElementById(`${id}-${activeId}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, id]);

  const move = (delta: number) => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((result) => result.id === activeId);
    const next =
      index === -1
        ? delta > 0
          ? 0
          : enabled.length - 1
        : (index + delta + enabled.length) % enabled.length;
    setActive({ query: settled, id: enabled[next]!.id });
  };
  const askAbout = (text: string) => {
    if (
      !aiAvailable ||
      composing ||
      text.trim().length < 2 ||
      ai.state.status === "RUNNING"
    )
      return;
    setQuery(text);
    onModeChange("AI");
    void ai.run(text);
    // The pressed control is disabled while the AI runs; typing, arrows and
    // Escape stay with the box.
    inputRef.current?.focus();
  };
  const ask = () => {
    if (canAsk) askAbout(query);
  };
  // Back to the empty box: no text, no chosen row, no AI request for the old
  // text, and the caret stays in the box (the clear button itself goes away).
  const clear = () => {
    ai.cancel();
    setComposing(false);
    setQuery("");
    setActive({ query: "", id: null });
    inputRef.current?.focus();
  };
  useImperativeHandle(clearOnEscape, () => () => {
    if (query === "") return false;
    clear();
    return true;
  });
  const choose = (result: SearchResult) => {
    if (stale) return;
    if (result.ask !== undefined) askAbout(result.ask);
    else if (result.target !== null)
      onNavigate(
        result.target,
        [result.trail, result.title].filter(Boolean).join(" › "),
      );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Thai and other IMEs confirm a candidate with Enter: never submit then.
    if (event.nativeEvent.isComposing || composing || event.keyCode === 229)
      return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeResult !== undefined) choose(activeResult);
      else if (mode === "AI") ask();
    }
  };

  const showRecordsStatus = settled !== "" && !stale;
  const status = statusText({
    t,
    settled,
    count: ordinary.length + aiChoices.length,
    typing: stale && !browsing,
    records: records.state,
    ordinaryOnly: aiActive,
  });
  // Only what Enter does now: open the active row, ask the AI, or nothing.
  const enter =
    activeResult !== undefined
      ? activeResult.ask === undefined
        ? "open"
        : "ask"
      : mode === "AI" && canAsk
        ? "ask"
        : null;
  const keys = [
    enabled.length > 0 ? t("keys.move") : null,
    enter === null ? null : t(`keys.${enter}`),
    t(query === "" ? "keys.close" : "keys.clear"),
  ]
    .filter(Boolean)
    .join(" · ");
  const firstOrdinary = shown.find((section) =>
    ORDINARY_GROUPS.includes(section.group),
  )?.group;

  return (
    <div className="grid min-h-0 gap-3">
      {/* Search owns its close so it shares the title's row and centre line;
          other dialogs keep the shared corner close. */}
      <div className="flex min-h-touch items-center justify-between gap-2 dense:min-h-control">
        <DialogHeader className="min-w-0 pr-0">
          <DialogTitle>{t(mode === "AI" ? "aiTitle" : "title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-1 shrink-0"
            aria-label={t("close")}
            data-testid="global-search-close"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </DialogClose>
      </div>
      {/* A phone gives the typed request the full row; Ask AI sits below. */}
      <div
        className="grid gap-2 sm:flex sm:items-center"
        data-testid="global-search-row"
      >
        <div className="relative min-w-0 sm:flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={t("inputLabel")}
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeId === null ? undefined : `${id}-${activeId}`
            }
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint={mode === "AI" ? "send" : "go"}
            maxLength={300}
            placeholder={t(
              mode === "AI"
                ? "aiPlaceholder"
                : canSearchPeople
                  ? "placeholderPeople"
                  : "placeholder",
            )}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={onKeyDown}
            className={cn(
              "min-h-touch w-full rounded-md border border-input bg-surface py-2 pl-9 text-base text-text outline-none placeholder:text-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring",
              // Typed text stops short of the clear button.
              query === "" ? "pr-3" : "pr-12 dense:pr-11",
            )}
            data-testid="global-search-input"
          />
          {query === "" ? null : (
            <IconButton
              label={t("clear")}
              variant="ghost"
              className="absolute inset-y-0 right-0 my-auto text-muted hover:text-text dense:right-1.5"
              // The caret stays in the box: a click must not move focus here.
              onMouseDown={(event) => event.preventDefault()}
              onClick={clear}
              data-testid="global-search-clear"
            >
              <X aria-hidden="true" />
            </IconButton>
          )}
        </div>
        {aiAvailable && !offerAsk ? (
          <Button
            type="button"
            variant={mode === "AI" ? "default" : "outline"}
            onClick={ask}
            disabled={!canAsk}
            aria-describedby={scopeId}
            className="w-full sm:w-auto"
            data-testid="global-search-ai"
          >
            <Sparkles aria-hidden="true" />
            {t("aiAsk")}
          </Button>
        ) : null}
      </div>
      {/* What the AI is for, wherever the user decides to ask: it finds a
          page or form, it does not answer questions. */}
      {aiAvailable ? (
        <p
          id={scopeId}
          className="-mt-1 flex items-start gap-1.5 text-xs text-muted"
          data-testid="global-search-ai-scope"
        >
          <Sparkles aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          {t("aiScope")}
        </p>
      ) : null}

      {aiAvailable && mode === "AI" ? (
        <AiPanel
          state={ai.state}
          context={context}
          onClearContext={() => setClearedContext(contextKey)}
          onCancel={ai.cancel}
        />
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className={cn(
          "text-xs text-muted",
          // The list's own labels say it: places to go, or the ordinary
          // results under the AI's answer.
          ((browsing && results.length > 0) || aiActive) && "sr-only",
        )}
        data-testid="global-search-status"
      >
        {status}
      </p>
      {records.node}

      <div
        id={listId}
        role="listbox"
        aria-label={t("resultsLabel")}
        className="min-h-0 overflow-y-auto overscroll-contain sm:max-h-[min(28rem,55dvh)]"
      >
        {aiActive && ai.state.status === "RUNNING" ? <AiPending /> : null}
        {shown.map((section) => {
          const labelId = `${id}-group-${section.group}`;
          const ordinaryHeading = aiActive && section.group === firstOrdinary;
          return (
            <div
              key={section.group}
              role="group"
              {...(section.labelled
                ? {
                    "aria-labelledby":
                      aiActive && ORDINARY_GROUPS.includes(section.group)
                        ? `${id}-ordinary ${labelId}`
                        : labelId,
                  }
                : { "aria-label": t("aiAsk") })}
              className="pb-2"
              data-testid={`global-search-group-${section.group.toLowerCase()}`}
            >
              {ordinaryHeading ? (
                <div
                  id={`${id}-ordinary`}
                  role="presentation"
                  className="mx-2 mt-1 mb-1 border-t border-border pt-3 text-xs font-semibold text-text"
                  data-testid="global-search-ordinary-heading"
                >
                  {t("ordinaryResults", { count: ordinary.length })}
                </div>
              ) : null}
              {section.labelled ? (
                <div
                  id={labelId}
                  role="presentation"
                  className="px-2 pt-2 pb-1 text-xs font-semibold text-muted"
                >
                  {t(`group.${section.group}`)}
                </div>
              ) : null}
              {section.items.map((result) => (
                <ResultOption
                  key={result.id}
                  id={`${id}-${result.id}`}
                  result={result}
                  query={settled}
                  stale={stale}
                  active={result.id === activeId}
                  onHover={() =>
                    !stale &&
                    (result.target !== null || result.ask !== undefined) &&
                    setActive({ query: settled, id: result.id })
                  }
                  onChoose={() => choose(result)}
                />
              ))}
            </div>
          );
        })}
      </div>
      {noMatch && !aiAvailable ? (
        <p
          className="text-sm text-muted"
          data-testid="global-search-no-match-hint"
        >
          {t(canSearchPeople ? "noMatchHintPeople" : "noMatchHintPages")}
        </p>
      ) : null}
      {showRecordsStatus && records.state.incomplete ? (
        <p
          className="text-xs text-warning"
          data-testid="global-search-incomplete"
        >
          {t("recordsIncomplete")}
        </p>
      ) : null}
      {showRecordsStatus && records.state.failed ? (
        <p
          className="text-xs text-warning"
          data-testid="global-search-records-failed"
        >
          {t("recordsUnavailable")}
        </p>
      ) : null}
      <p
        className="hidden text-xs text-muted sm:block"
        aria-hidden="true"
        data-testid="global-search-keys"
      >
        {keys}
      </p>
    </div>
  );
}

/**
 * Example requests for the member's HR grants, offered before anything is
 * typed. Choosing one asks the AI at once, so an example that refers to
 * "this record" appears only while a page has published one.
 */
function useExampleResults(
  granted: readonly string[],
  context: PageSearchContext | null,
): readonly SearchResult[] {
  const t = useTranslations("Search");
  return useMemo(() => {
    const self = hasNavigationPermission([HR_CODES.self], granted);
    return [
      ...(self ? [t("exampleSelf")] : []),
      ...(context !== null &&
      hasNavigationPermission([HR_CODES.review], granted)
        ? [t("exampleReview")]
        : []),
      ...(hasNavigationPermission([HR_CODES.admin], granted)
        ? [t("exampleHoliday")]
        : self
          ? [t("exampleProfile")]
          : []),
    ]
      .slice(0, 3)
      .map((text, index) => ({
        id: `ask-example-${index}`,
        group: "ASK" as const,
        title: text,
        trail: "",
        target: null,
        ask: text,
      }));
  }, [context, granted, t]);
}

type Translate = ReturnType<typeof useTranslations>;

/**
 * The live status. "No match" is said only when every record search
 * answered completely: a failed, refused or bounded read says so instead,
 * in words that reveal nothing about records outside the member's scope.
 * Beside an AI answer it counts only the ordinary results.
 */
function statusText(input: {
  readonly t: Translate;
  readonly settled: string;
  readonly count: number;
  readonly typing: boolean;
  readonly records: {
    readonly loading: boolean;
    readonly failed: boolean;
    readonly incomplete: boolean;
  };
  readonly ordinaryOnly: boolean;
}): string {
  const { t, records } = input;
  if (input.typing || (input.settled !== "" && records.loading))
    return input.count > 0
      ? t("resultsLoading", { count: input.count })
      : t("recordsLoading");
  if (input.settled === "") return t("empty");
  if (input.count > 0)
    return t(input.ordinaryOnly ? "ordinaryResults" : "results", {
      count: input.count,
    });
  if (input.ordinaryOnly) return t("ordinaryNone");
  if (records.failed) return t("noMatchUnavailable");
  if (records.incomplete) return t("noMatchIncomplete");
  return t("noMatch");
}

/** The title with the typed text marked; read out as the plain title. */
function Highlighted({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}) {
  const parts = useMemo(() => highlightParts(text, query), [query, text]);
  return parts.map((part, index) =>
    part.match ? (
      <mark key={index} className="bg-transparent font-bold text-link">
        {part.text}
      </mark>
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    ),
  );
}

function ResultOption({
  id,
  result,
  query,
  stale,
  active,
  onHover,
  onChoose,
}: {
  readonly id: string;
  readonly result: SearchResult;
  /** The text the results answer; its match is marked in the title. */
  readonly query: string;
  /** Shown for the previous text; not openable until results settle. */
  readonly stale: boolean;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}) {
  const disabled =
    stale || (result.target === null && result.ask === undefined);
  // Places to go and things to ask are one line each.
  const compact = result.group === "GOTO" || result.group === "ASK";
  return (
    // Options are activated from the combobox (Enter) or by pointer.
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      onMouseMove={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={disabled ? undefined : onChoose}
      className={cn(
        "min-h-touch cursor-pointer rounded-lg px-3 py-2 text-left",
        compact
          ? "flex items-center gap-3 dense:min-h-control dense:py-1.5"
          : "grid gap-0.5",
        active
          ? "bg-accent-surface shadow-[inset_3px_0_0_var(--color-link)]"
          : "hover:bg-raised",
        disabled && "cursor-default opacity-80 hover:bg-transparent",
      )}
      {...(result.id === "ask-query"
        ? { "data-testid": "global-search-ask-query" }
        : {})}
    >
      {result.group === "ASK" ? (
        <>
          <Sparkles aria-hidden="true" className="size-4 shrink-0 text-link" />
          <span className="min-w-0 flex-1 break-words text-text">
            {result.title}
          </span>
        </>
      ) : result.group === "GOTO" ? (
        <>
          <span className="min-w-0 flex-1 font-medium break-words text-text">
            {result.title}
          </span>
          <span className="shrink-0 text-xs text-muted">{result.trail}</span>
        </>
      ) : (
        <>
          <span className="text-xs break-words text-muted">{result.trail}</span>
          <span className="font-semibold break-words text-text">
            <Highlighted text={result.title} query={query} />
          </span>
          {result.detail ? (
            <span className="text-xs break-words text-muted">
              {result.detail}
            </span>
          ) : null}
          {result.action ? (
            <span className="text-xs text-link">{result.action}</span>
          ) : null}
          {result.hint ? (
            <span className="text-xs text-warning">{result.hint}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Marks where the AI's choices will appear while it works: one short
 * result-shaped line pair, so the ordinary results stay close to the box.
 * The progress panel above already says what is happening.
 */
function AiPending() {
  return (
    <div
      aria-hidden="true"
      className="grid gap-1.5 px-3 pt-1 pb-3"
      data-testid="global-search-ai-pending"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-4 w-1/2 max-w-64" />
    </div>
  );
}

function aiResults(
  state: AiState,
  toResult: ReturnType<typeof useResultLabels>["choiceResult"],
): readonly SearchResult[] {
  if (state.status !== "DONE") return [];
  const outcome = state.outcome;
  const choices =
    outcome.kind === "CHOOSE"
      ? outcome.choices
      : outcome.kind === "CLARIFY" || outcome.kind === "UNSUPPORTED"
        ? outcome.suggestions
        : [];
  return choices
    .slice(0, 8)
    .map((choice, index) => toResult(choice, "AI", index));
}

function AiPanel({
  state,
  context,
  onClearContext,
  onCancel,
}: {
  readonly state: AiState;
  readonly context: PageSearchContext | null;
  readonly onClearContext: () => void;
  readonly onCancel: () => void;
}) {
  const t = useTranslations("Search");
  const nav = useTranslations("Navigation");
  const locale = useLocale();
  const contextTrail =
    context === null
      ? null
      : [
          nav("sectionHr"),
          nav(
            context.page === "hr.review"
              ? "hrReview"
              : context.page === "hr.employees"
                ? "hrEmployees"
                : context.page === "hr.period"
                  ? "hrPeriods"
                  : "hrTime",
          ),
          context.employee?.code,
          context.date === undefined
            ? undefined
            : formatBusinessDate(context.date, locale, { short: true }),
          context.period === undefined
            ? undefined
            : `${context.period.siteCode} ${formatBusinessDate(context.period.startDate, locale, { short: true })} – ${formatBusinessDate(context.period.endDate, locale, { short: true })}`,
        ]
          .filter(Boolean)
          .join(" › ");
  // The panel holds the context in use and the current request's state.
  if (contextTrail === null && state.status === "IDLE") return null;
  return (
    <section
      aria-label={t("aiTitle")}
      className="grid gap-2 rounded-lg border border-border bg-raised p-3 text-sm"
      data-testid="global-search-ai-panel"
    >
      {contextTrail === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="min-w-0 break-words text-text"
            data-testid="global-search-context"
          >
            {t("contextLabel", { trail: contextTrail })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClearContext}
          >
            <X aria-hidden="true" />
            {t("contextClear")}
          </Button>
        </div>
      )}
      <AiStatus state={state} onCancel={onCancel} />
    </section>
  );
}

/**
 * The request's state, one row tall whether running or answered, so the
 * answer replaces the progress line without moving what is below.
 */
function AiStatus({
  state,
  onCancel,
}: {
  readonly state: AiState;
  readonly onCancel: () => void;
}) {
  const t = useTranslations("Search");
  if (state.status === "IDLE") return null;
  if (state.status === "RUNNING")
    return (
      <div
        className="flex min-h-touch items-center justify-between gap-3 dense:min-h-control"
        data-testid="global-search-ai-running"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Spinner aria-hidden="true" className="text-link" />
          {/* Only the words are announced; Cancel stays out of the region. */}
          <p role="status" className="min-w-0 text-text">
            {t("aiRunning")}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t("aiCancel")}
        </Button>
      </div>
    );
  if (state.status === "ERROR")
    return (
      <p
        role="alert"
        className="flex min-h-touch items-center text-warning dense:min-h-control"
        data-testid="global-search-ai-error"
      >
        {t(`aiError.${state.code}`, {
          minutes: Math.max(1, Math.ceil((state.retryAfterMs ?? 0) / 60_000)),
        })}
      </p>
    );
  return (
    <div
      className="grid min-h-touch content-center gap-1 dense:min-h-control"
      data-testid="global-search-ai-outcome"
    >
      <p role="status" className="font-semibold text-text">
        {outcomeText(t, state.outcome)}
      </p>
      {state.dropped.length > 0 ? (
        <p className="text-xs text-muted">{t("aiDropped")}</p>
      ) : null}
    </div>
  );
}

function outcomeText(t: Translate, outcome: IntentOutcome): string {
  switch (outcome.kind) {
    case "CHOOSE":
      return t(`choose.${outcome.reason}`);
    case "CLARIFY":
      return t(`clarify.${outcome.need}`);
    case "UNSUPPORTED":
      return t(`unsupported.${outcome.topic}`);
    case "NO_MATCH":
      return t(outcome.incomplete ? "aiNoMatchIncomplete" : "aiNoMatch");
    case "UNAVAILABLE":
      return t("recordsUnavailable");
    case "NAVIGATE":
      return t("aiOpening");
  }
}
