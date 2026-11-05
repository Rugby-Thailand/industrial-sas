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
import { useRecentDestinations } from "./recent";
import { SearchResultsViewport } from "./SearchResultsViewport";
import {
  searchesPeople,
  usePlaceResults,
  useRecordResults,
  useResultLabels,
  useStaticResults,
  type ResultGroup,
  type SearchResult,
} from "./results";
import { useAiSearch, type AiState } from "./useAiSearch";

/** Ordinary (non-AI) results of a typed query, in display order. */
const ORDINARY_GROUPS: readonly ResultGroup[] = [
  "PAGES",
  "EMPLOYEES",
  "PERIODS",
  "TASKS",
];
/** Groups of typed results; their headings count them. */
const COUNTED_GROUPS: readonly ResultGroup[] = ["AI", ...ORDINARY_GROUPS];
/**
 * Record groups: the heading names the kind and the action line says what
 * opens, so a trail on their rows would only repeat them.
 */
const RECORD_GROUPS: readonly ResultGroup[] = ["EMPLOYEES", "PERIODS"];
/** The row that offers the typed text to the AI. */
const ASK_ID = "ask-query";
const DEBOUNCE_MS = 250;

interface Section {
  readonly group: ResultGroup;
  readonly items: readonly SearchResult[];
  /** False: the group is named for assistive technology only. */
  readonly labelled: boolean;
  /** What the group is for, under its heading; the group's description. */
  readonly description?: string;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const settled = useSettledText(query, composing);
  const today = hr.today ?? null;
  // Nothing typed: the list offers places to go and things to ask.
  const browsing = query.trim() === "";
  const canSearchPeople = searchesPeople(granted);

  // The page context is shown and can be cleared; a new record re-offers it.
  const contextKey = pageContext === null ? "" : JSON.stringify(pageContext);
  const [clearedContext, setClearedContext] = useState<string | null>(null);
  const context =
    contextKey !== "" && clearedContext !== contextKey ? pageContext : null;

  const staticResults = useStaticResults(settled, granted, pathname);
  const records = useRecordResults(settled, granted, today, settled !== "");
  const places = usePlaceResults(granted, pathname, useRecentDestinations());
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
  // While the AI works on (or has answered) this text, the count of the
  // typed results is for screen readers only. Once its answer or error sits
  // above them, they are labelled as such, so neither is taken for the other.
  const aiActive = mode === "AI" && ai.state.status !== "IDLE";
  const running = ai.state.status === "RUNNING";
  const aiAnswered = aiActive && !running;

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
    aiAvailable && !composing && query.trim().length >= 2 && !running;
  const noResults =
    !browsing && ordinary.length === 0 && aiChoices.length === 0;
  const noMatch = noResults && !stale && !records.state.loading;
  // Whether the latest settled text matched nothing. It holds while the next
  // text is typed and searched, so the guidance and places to go do not
  // come and go on every keystroke.
  const [unmatched, setUnmatched] = useState(false);
  const outcome = browsing
    ? false
    : stale || records.state.loading
      ? unmatched
      : noMatch;
  if (outcome !== unmatched) setUnmatched(outcome);
  // The one AI action for typed text: a row after the typed results, so
  // first when nothing matches. It asks about the text as typed, so unlike
  // the results it can be chosen before the text settles. A running request
  // takes its place, and an answer for this text replaces it.
  const askRow: readonly SearchResult[] =
    aiAvailable &&
    !browsing &&
    query.trim().length >= 2 &&
    (ai.state.status === "IDLE" || ai.state.status === "ERROR")
      ? [
          {
            id: ASK_ID,
            group: "ASK",
            title: t("askQuery", { query: query.trim() }),
            // What the AI is for, on the one row that asks it.
            detail: t("aiScope"),
            trail: "",
            target: null,
            ask: query,
          },
        ]
      : [];

  const recent: Section = {
    group: "RECENT",
    items: places.recent,
    labelled: true,
  };
  const goTo: Section = { group: "GOTO", items: places.goTo, labelled: true };
  const tryAsking: Section = {
    group: "ASK",
    items: aiAvailable ? examples : [],
    labelled: true,
    description: `${t("aiScope")} ${t("aiPrivacy")}`,
  };
  // Nothing matched (held while the next text is typed): the status says
  // what can be searched, and the list offers places to go after the AI
  // row, except while the AI works on it. A failed or partial record search
  // says its own next step instead.
  const guidance = outcome && noResults && !running;
  const hint =
    guidance && !records.state.failed && !records.state.incomplete
      ? t(canSearchPeople ? "noMatchHintPeople" : "noMatchHintPages")
      : null;
  const sections: readonly Section[] = browsing
    ? // Asked the AI and cleared the box: its examples come first.
      mode === "AI"
      ? [tryAsking, recent, goTo]
      : [recent, goTo, tryAsking]
    : [
        { group: "AI", items: aiChoices, labelled: true },
        ...ORDINARY_GROUPS.map((group) => {
          const items = ordinary.filter((result) => result.group === group);
          const sharedAction =
            RECORD_GROUPS.includes(group) &&
            items.length > 1 &&
            items.every((item) => item.action === items[0]?.action)
              ? items[0]?.action
              : undefined;
          return {
            group,
            items,
            labelled: true,
            ...(sharedAction === undefined
              ? {}
              : { description: sharedAction }),
          };
        }),
        { group: "ASK", items: askRow, labelled: false },
        ...(guidance
          ? [
              {
                group: "GOTO" as const,
                items: places.shortcuts,
                labelled: true,
              },
            ]
          : []),
      ];
  const shown = sections.filter((section) => section.items.length > 0);
  const results = shown.flatMap((section) => section.items);
  // Results belong to the settled text; a row that asks belongs to the text
  // as typed. Neither can be chosen while an IME composes.
  const choosable = (result: SearchResult) =>
    result.ask === undefined ? !stale && result.target !== null : !composing;
  const enabled = results.filter(choosable);
  // Normal search starts on the first openable result, or on the AI row
  // when nothing matched; AI mode leaves Enter to ask until the user moves.
  // Places offered after a miss are reached with the arrows: Enter must not
  // open one by surprise.
  const [active, setActive] = useState<{ query: string; id: string | null }>({
    query: "",
    id: null,
  });
  const settledEnabled = stale ? [] : enabled;
  const firstTyped = settledEnabled.find(
    (result) => result.group !== "GOTO" && result.group !== "ASK",
  );
  const askFirst =
    noResults && settledEnabled.some((result) => result.id === ASK_ID);
  const activeId =
    active.query === settled &&
    enabled.some((result) => result.id === active.id)
      ? active.id
      : browsing
        ? mode === "AI"
          ? null
          : (settledEnabled[0]?.id ?? null)
        : mode !== "AI" && firstTyped !== undefined
          ? firstTyped.id
          : askFirst
            ? ASK_ID
            : null;
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
    setActive({ query: text, id: null });
    onModeChange("AI");
    void ai.run(text);
    // The chosen row gives way to the progress row; typing, arrows and
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
    if (!choosable(result)) return;
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
  const count = ordinary.length + aiChoices.length;
  const status = statusText({
    t,
    settled,
    count,
    typing: stale && !browsing,
    records: records.state,
    ordinaryOnly: aiActive,
  });
  // The group headings already say what was found, and the AI's progress or
  // answer says what it is doing: then the count is for screen readers only.
  const quietStatus =
    (browsing && results.length > 0) || aiActive || (!browsing && count > 0);
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
  const ordinaryShown = shown.filter((section) =>
    ORDINARY_GROUPS.includes(section.group),
  );
  const firstOrdinary = ordinaryShown[0]?.group;

  return (
    <div className="flex max-h-[calc(100dvh-1.5rem)] min-h-0 flex-col gap-3 sm:max-h-[calc(min(42rem,80dvh)-2rem)]">
      {/* Search owns its close so it shares the title's row and centre line;
          other dialogs keep the shared corner close. */}
      <div className="flex min-h-touch shrink-0 items-center justify-between gap-2 dense:min-h-control">
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
      {/* The box has the row to itself: the AI is offered in the list. */}
      <div className="relative min-w-0 shrink-0">
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

      {aiAvailable && mode === "AI" ? (
        <AiPanel
          state={ai.state}
          context={context}
          onClearContext={() => setClearedContext(contextKey)}
        />
      ) : null}

      {/* The miss and what to try instead, read out together, on the
          group headings' edge. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "px-2 text-sm",
          quietStatus ? "sr-only" : noMatch ? "text-text" : "text-muted",
        )}
        data-testid="global-search-status"
      >
        {status}
        {hint === null ? null : (
          <>
            {" "}
            <span
              className="block text-muted"
              data-testid="global-search-no-match-hint"
            >
              {hint}
            </span>
          </>
        )}
      </p>
      {records.node}

      <SearchResultsViewport id={listId} label={t("resultsLabel")}>
        {shown.map((section) => {
          const labelId = `${id}-group-${section.group}`;
          const noteId = `${id}-note-${section.group}`;
          const typed = ORDINARY_GROUPS.includes(section.group);
          // Under the AI's answer, one heading names the results of the
          // typed text; a group is named as well only beside another.
          const underAi = aiAnswered && typed;
          const ordinaryHeading = underAi && section.group === firstOrdinary;
          const heading =
            section.labelled && !(underAi && ordinaryShown.length === 1);
          return (
            <div
              key={section.group}
              role="group"
              {...(section.labelled
                ? {
                    "aria-labelledby": underAi
                      ? [`${id}-ordinary`, heading ? labelId : null]
                          .filter(Boolean)
                          .join(" ")
                      : labelId,
                  }
                : { "aria-label": t("aiAsk") })}
              {...(section.description === undefined
                ? {}
                : { "aria-describedby": noteId })}
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
                  {t("ordinaryHeading")}
                  <GroupCount count={ordinary.length} />
                </div>
              ) : null}
              {heading ? (
                <div
                  id={labelId}
                  role="presentation"
                  className="px-2 pt-2 pb-1 text-xs font-semibold text-muted"
                >
                  {t(`group.${section.group}`)}
                  {COUNTED_GROUPS.includes(section.group) ? (
                    <GroupCount count={section.items.length} />
                  ) : null}
                </div>
              ) : null}
              {section.description === undefined ? null : (
                <div
                  id={noteId}
                  role="presentation"
                  className="px-2 pb-1 text-xs text-muted"
                  data-testid={
                    section.group === "ASK"
                      ? "global-search-ask-scope"
                      : undefined
                  }
                >
                  {section.description}
                </div>
              )}
              {section.items.map((result) => (
                <ResultOption
                  key={result.id}
                  id={`${id}-${result.id}`}
                  result={result}
                  query={settled}
                  sharedAction={section.description === result.action}
                  disabled={!choosable(result)}
                  active={result.id === activeId}
                  onHover={() =>
                    choosable(result) &&
                    setActive({ query: settled, id: result.id })
                  }
                  onChoose={() => choose(result)}
                />
              ))}
            </div>
          );
        })}
      </SearchResultsViewport>
      {/* A running request in the AI row's place: after the typed results,
          first when there are none. Its Cancel stays out of the listbox. */}
      {running ? <AiRunning onCancel={ai.cancel} /> : null}
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
  sharedAction,
  disabled,
  active,
  onHover,
  onChoose,
}: {
  readonly id: string;
  readonly result: SearchResult;
  /** The text the results answer; its match is marked in the title. */
  readonly query: string;
  /** The group already states the common action; retain its row description. */
  readonly sharedAction: boolean;
  /** Needs more input, or shown for the previous text until it settles. */
  readonly disabled: boolean;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}) {
  const t = useTranslations("Search");
  // Places to go and things to ask are one line each; an offer to ask about
  // the typed text says under it what the AI is for.
  const place = result.group === "RECENT" || result.group === "GOTO";
  const compact = place || result.group === "ASK";
  // A result is named by its title; where it sits (or that it is the page
  // already open), what it is and what opening it does describe it.
  const aside = result.current
    ? t("thisPage")
    : RECORD_GROUPS.includes(result.group)
      ? ""
      : result.trail;
  const notes = compact
    ? [
        result.detail === undefined ? null : "detail",
        result.id === ASK_ID ? "privacy" : null,
        place && result.trail ? "aside" : null,
      ]
    : [
        aside === "" ? null : "aside",
        result.detail ? "detail" : null,
        result.action ? "action" : null,
        result.hint ? "hint" : null,
      ];
  const describedBy = notes
    .filter(Boolean)
    .map((note) => `${id}-${note}`)
    .join(" ");
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
          : "grid content-center gap-0.5",
        active
          ? "bg-accent-surface shadow-[inset_3px_0_0_var(--color-link)]"
          : "hover:bg-raised",
        result.id === ASK_ID && "items-start",
        disabled && "cursor-default opacity-80 hover:bg-transparent",
      )}
      aria-labelledby={`${id}-title`}
      {...(describedBy !== "" ? { "aria-describedby": describedBy } : {})}
      {...(result.id === ASK_ID ? { "data-testid": "global-search-ai" } : {})}
    >
      {result.group === "ASK" ? (
        <>
          <Sparkles
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-link",
              result.id === ASK_ID && "mt-1",
            )}
          />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span id={`${id}-title`} className="break-words text-text">
              {result.title}
            </span>
            {result.detail === undefined ? null : (
              <span
                id={`${id}-detail`}
                className="text-xs break-words text-muted"
              >
                {result.detail}
              </span>
            )}
            {result.id === ASK_ID ? (
              <span
                id={`${id}-privacy`}
                className="text-xs break-words text-muted"
                data-testid="global-search-ai-privacy"
              >
                {t("aiPrivacy")}
              </span>
            ) : null}
          </span>
        </>
      ) : place ? (
        <>
          <span
            id={`${id}-title`}
            className="min-w-0 flex-1 font-medium break-words text-text"
          >
            {result.title}
          </span>
          <span id={`${id}-aside`} className="shrink-0 text-xs text-muted">
            {result.trail}
          </span>
        </>
      ) : (
        <>
          {/* The title leads; where it sits takes the places' right slot. */}
          <span className="flex items-baseline justify-between gap-3">
            <span
              id={`${id}-title`}
              className="min-w-0 font-semibold break-words text-text"
            >
              <Highlighted text={result.title} query={query} />
            </span>
            {aside === "" ? null : (
              <span
                id={`${id}-aside`}
                className="shrink-0 text-xs text-muted"
                data-testid={
                  result.current ? "global-search-this-page" : undefined
                }
              >
                {aside}
              </span>
            )}
          </span>
          {result.detail ? (
            <span
              id={`${id}-detail`}
              className="text-xs break-words text-muted"
            >
              <Highlighted text={result.detail} query={query} />
            </span>
          ) : null}
          {result.action ? (
            <span
              id={`${id}-action`}
              className={cn("text-xs text-muted", sharedAction && "sr-only")}
            >
              {result.action}
            </span>
          ) : null}
          {result.hint ? (
            <span id={`${id}-hint`} className="text-xs text-warning">
              {result.hint}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A typed-results heading's count, shown when there is more than one. */
function GroupCount({ count }: { readonly count: number }) {
  // The live status announces the count; group names stay plain.
  return count > 1 ? (
    <span aria-hidden="true" className="font-normal tabular-nums">
      {` (${count})`}
    </span>
  ) : null;
}

/**
 * A running AI request in the AI row's place, shaped like that row: what is
 * happening and how to stop it. It is the only AI control while it runs.
 */
function AiRunning({ onCancel }: { readonly onCancel: () => void }) {
  const t = useTranslations("Search");
  return (
    <div
      className="flex min-h-touch shrink-0 items-start gap-3 rounded-lg bg-accent-surface px-3 py-2 shadow-[inset_3px_0_0_var(--color-link)] dense:min-h-control"
      data-testid="global-search-ai-running"
    >
      <Spinner aria-hidden="true" className="mt-1 shrink-0 text-link" />
      {/* Only the words are announced; Cancel stays out of the region. */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p role="status" className="text-sm text-text">
          {t("aiRunning")}
        </p>
        <p className="text-xs text-muted">{t("aiScope")}</p>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onCancel}>
        {t("aiCancel")}
      </Button>
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
}: {
  readonly state: AiState;
  readonly context: PageSearchContext | null;
  readonly onClearContext: () => void;
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
  // The panel holds the context in use and the request's answer or error;
  // a running request has its own row under the box.
  if (
    contextTrail === null &&
    (state.status === "IDLE" || state.status === "RUNNING")
  )
    return null;
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
      <AiStatus state={state} />
    </section>
  );
}

/** The request's answer or error, one row tall like the progress row. */
function AiStatus({ state }: { readonly state: AiState }) {
  const t = useTranslations("Search");
  if (state.status === "IDLE" || state.status === "RUNNING") return null;
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
