"use client";

import { Search, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBusinessDate } from "@/features/hr/format";
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
import {
  useRecordResults,
  useResultLabels,
  useStaticResults,
  type ResultGroup,
  type SearchResult,
} from "./results";
import { useAiSearch, type AiState } from "./useAiSearch";

const GROUP_ORDER: readonly ResultGroup[] = ["AI", "PAGES", "RECORDS", "TASKS"];
const DEBOUNCE_MS = 250;

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
  open,
  mode,
  aiAvailable,
  granted,
  pageContext,
  onOpenChange,
  onModeChange,
  onNavigate,
}: {
  readonly open: boolean;
  readonly mode: SearchMode;
  readonly aiAvailable: boolean;
  readonly granted: readonly string[];
  readonly pageContext: PageSearchContext | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onModeChange: (mode: SearchMode) => void;
  readonly onNavigate: (target: DestinationTarget, trail: string) => boolean;
}) {
  const t = useTranslations("Search");
  // An accepted destination takes focus itself (a deep-link section), so
  // this close must not hand focus back to the opener after it. Escape, the
  // close button and a refused target leave the ordinary return in place.
  const navigated = useRef(false);
  const navigate = (target: DestinationTarget, trail: string) => {
    const accepted = onNavigate(target, trail);
    if (accepted) navigated.current = true;
    return accepted;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        closeLabel={t("close")}
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
      >
        {open ? (
          <SearchBody
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
  mode,
  aiAvailable,
  granted,
  pageContext,
  onModeChange,
  onNavigate,
}: {
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
  const id = useId();
  const listId = `${id}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const settled = useSettledText(query, composing);
  const today = hr.today ?? null;

  // The page context is shown and can be cleared; a new record re-offers it.
  const contextKey = pageContext === null ? "" : JSON.stringify(pageContext);
  const [clearedContext, setClearedContext] = useState<string | null>(null);
  const context =
    contextKey !== "" && clearedContext !== contextKey ? pageContext : null;

  const staticResults = useStaticResults(settled, granted);
  const records = useRecordResults(settled, granted, today, settled !== "");
  const go = (result: SearchResult) =>
    !stale &&
    result.target !== null &&
    onNavigate(result.target, `${result.trail} › ${result.title}`);
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

  const results = useMemo(() => {
    const all = [...aiChoices, ...staticResults, ...records.state.results];
    return GROUP_ORDER.flatMap((group) =>
      all.filter((result) => result.group === group),
    );
  }, [aiChoices, records.state.results, staticResults]);
  // Results belong to the settled text. While the input differs (typing,
  // before the pause) or an IME is composing, they are shown but cannot be
  // opened: Enter or a click must never open the previous query's record.
  const stale = composing || settled !== (query.trim() === "" ? "" : query);
  const enabled = stale
    ? []
    : results.filter((result) => result.target !== null);
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
  const canAsk =
    aiAvailable &&
    !composing &&
    query.trim().length >= 2 &&
    ai.state.status !== "RUNNING";
  const ask = () => {
    if (!canAsk) return;
    onModeChange("AI");
    void ai.run();
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
      const result = enabled.find((entry) => entry.id === activeId);
      if (result !== undefined) go(result);
      else if (mode === "AI") ask();
    }
  };

  const showRecordsStatus = settled !== "" && !stale;
  const status = statusText({
    t,
    settled,
    count: results.length,
    typing: stale && query.trim() !== "",
    records: records.state,
  });

  return (
    <div className="grid min-h-0 gap-3">
      <DialogHeader className="pr-12">
        <DialogTitle>{t(mode === "AI" ? "aiTitle" : "title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("description")}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
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
            placeholder={t(mode === "AI" ? "aiPlaceholder" : "placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={onKeyDown}
            className="min-h-touch w-full rounded-md border border-input bg-surface py-2 pr-3 pl-9 text-base text-text outline-none placeholder:text-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring"
            data-testid="global-search-input"
          />
        </div>
        {aiAvailable ? (
          <Button
            type="button"
            variant={mode === "AI" ? "default" : "outline"}
            onClick={ask}
            disabled={!canAsk}
            data-testid="global-search-ai"
          >
            <Sparkles aria-hidden="true" />
            {t("aiAsk")}
          </Button>
        ) : null}
      </div>

      {/* Said before anything is sent: visible in both modes, next to the
          button that sends it. */}
      {aiAvailable ? (
        <p
          className="text-xs text-muted"
          data-testid="global-search-ai-disclosure"
        >
          {t("aiPrivacy")}
        </p>
      ) : null}

      {aiAvailable && mode === "AI" ? (
        <AiPanel
          state={ai.state}
          context={context}
          granted={granted}
          onClearContext={() => setClearedContext(contextKey)}
          onCancel={ai.cancel}
          onExample={(text) => {
            setQuery(text);
            inputRef.current?.focus();
          }}
          showExamples={query.trim() === ""}
        />
      ) : null}

      <p role="status" aria-live="polite" className="text-xs text-muted">
        {status}
      </p>
      {records.node}

      <div
        id={listId}
        role="listbox"
        aria-label={t("resultsLabel")}
        className="min-h-0 overflow-y-auto overscroll-contain sm:max-h-[min(28rem,55dvh)]"
      >
        {GROUP_ORDER.map((group) => {
          const items = results.filter((result) => result.group === group);
          if (items.length === 0) return null;
          return (
            <div
              key={group}
              role="group"
              aria-labelledby={`${id}-group-${group}`}
              className="pb-2"
            >
              <div
                id={`${id}-group-${group}`}
                role="presentation"
                className="px-2 pt-2 pb-1 text-xs font-semibold text-muted"
              >
                {t(`group.${group}`)}
              </div>
              {items.map((result) => (
                <ResultOption
                  key={result.id}
                  id={`${id}-${result.id}`}
                  result={result}
                  stale={stale}
                  active={result.id === activeId}
                  onHover={() =>
                    !stale &&
                    result.target !== null &&
                    setActive({ query: settled, id: result.id })
                  }
                  onChoose={() => go(result)}
                />
              ))}
            </div>
          );
        })}
      </div>
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
      <p className="hidden text-xs text-muted sm:block" aria-hidden="true">
        {t("keyboardHint")}
      </p>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations>;

/**
 * The live status. "No match" is said only when every record search
 * answered completely: a failed, refused or bounded read says so instead,
 * in words that reveal nothing about records outside the member's scope.
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
}): string {
  const { t, records } = input;
  if (input.settled === "") return t("empty");
  if (input.typing || records.loading)
    return input.count > 0
      ? t("resultsLoading", { count: input.count })
      : t("recordsLoading");
  if (input.count > 0) return t("results", { count: input.count });
  if (records.failed) return t("noMatchUnavailable");
  if (records.incomplete) return t("noMatchIncomplete");
  return t("noMatch");
}

function ResultOption({
  id,
  result,
  stale,
  active,
  onHover,
  onChoose,
}: {
  readonly id: string;
  readonly result: SearchResult;
  /** Shown for the previous text; not openable until results settle. */
  readonly stale: boolean;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}) {
  const disabled = stale || result.target === null;
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
        "grid min-h-touch cursor-pointer gap-0.5 rounded-lg px-3 py-2 text-left",
        active ? "bg-selected ring-1 ring-link" : "hover:bg-raised",
        disabled && "cursor-default opacity-80 hover:bg-transparent",
      )}
    >
      <span className="text-xs break-words text-muted">{result.trail}</span>
      <span className="font-semibold break-words text-text">
        {result.title}
      </span>
      {result.detail ? (
        <span className="text-xs break-words text-muted">{result.detail}</span>
      ) : null}
      {result.action ? (
        <span className="text-xs text-link">{result.action}</span>
      ) : null}
      {result.hint ? (
        <span className="text-xs text-warning">{result.hint}</span>
      ) : null}
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
  granted,
  onClearContext,
  onCancel,
  onExample,
  showExamples,
}: {
  readonly state: AiState;
  readonly context: PageSearchContext | null;
  readonly granted: readonly string[];
  readonly onClearContext: () => void;
  readonly onCancel: () => void;
  readonly onExample: (text: string) => void;
  readonly showExamples: boolean;
}) {
  const t = useTranslations("Search");
  const nav = useTranslations("Navigation");
  const locale = useLocale();
  const examples = [
    ...(hasNavigationPermission([HR_CODES.self], granted)
      ? [t("exampleSelf")]
      : []),
    ...(hasNavigationPermission([HR_CODES.review], granted)
      ? [t("exampleReview")]
      : []),
    ...(hasNavigationPermission([HR_CODES.admin], granted)
      ? [t("exampleHoliday")]
      : hasNavigationPermission([HR_CODES.self], granted)
        ? [t("exampleProfile")]
        : []),
  ].slice(0, 3);
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
  // Examples (with a one-line prompt) only before anything is typed; after
  // that the panel holds just the context in use and the current outcome.
  const offerExamples = showExamples && examples.length > 0;
  if (!offerExamples && contextTrail === null && state.status === "IDLE")
    return null;
  return (
    <section
      aria-label={t("aiTitle")}
      className="grid gap-2 rounded-lg border border-border bg-raised p-3 text-sm"
      data-testid="global-search-ai-panel"
    >
      {offerExamples ? (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label={t("examples")}
          role="group"
        >
          <span className="text-muted">{t("aiIntro")}</span>
          {examples.map((example) => (
            <Button
              key={example}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onExample(example)}
            >
              {example}
            </Button>
          ))}
        </div>
      ) : null}
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
      <div className="flex flex-wrap items-center gap-2" role="status">
        <span className="text-text">{t("aiRunning")}</span>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("aiCancel")}
        </Button>
      </div>
    );
  if (state.status === "ERROR")
    return (
      <p
        role="alert"
        className="text-warning"
        data-testid="global-search-ai-error"
      >
        {t(`aiError.${state.code}`, {
          minutes: Math.max(1, Math.ceil((state.retryAfterMs ?? 0) / 60_000)),
        })}
      </p>
    );
  return (
    <div className="grid gap-1" data-testid="global-search-ai-outcome">
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
