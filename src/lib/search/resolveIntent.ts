/**
 * Turns a grounded AI intent into what the dialog does next, using only the
 * protected HR search queries for records.
 *
 * Automatic navigation is deterministic and narrow: the destination is a
 * static page the member may open, or a record identified by one exact
 * code (or the page selection the query refers to) together with an
 * explicit, fully written past date (or range) and, for periods, an
 * available version, where the protected query answered completely with
 * exactly one match. Names, inferred years, missing dates, several codes or
 * sites, and incomplete reads become choices or a question; future days,
 * unusable dates and versions, and model values grounding rejected become
 * a question without actionable targets. The model's own confidence is
 * never consulted, and a person the model invented is never read as the
 * actor's own day.
 */
import type {
  EmployeeFocus,
  GroundedIntent,
  UnsupportedTopic,
} from "../../../convex/model/search/intent";
import { addDays, compareDates } from "../../../convex/model/hr/calendar";
import {
  HR_CODES,
  destinationHref,
  hasNavigationPermission,
  targetPermissions,
  type DestinationTarget,
  type StaticDestinationKey,
} from "../navigation";

export interface EmployeeHit {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly siteCode: string;
  readonly active: boolean;
  readonly match: string;
}
export interface EmployeeLookup {
  readonly items: readonly EmployeeHit[];
  readonly complete: boolean;
}
export interface PeriodHit {
  readonly id: string;
  readonly siteCode: string;
  readonly siteName: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: "DRAFT" | "CLOSED";
  readonly latestClosedVersion: number;
}
export interface PeriodLookup {
  readonly items: readonly PeriodHit[];
  readonly complete: boolean;
}

/**
 * Protected lookups; `null` means the query was denied or failed. With
 * `codes` the server looks those codes up exactly and compares no names.
 */
export interface IntentLookups {
  readonly reviewEmployees: (
    text: string,
    codes?: readonly string[],
  ) => Promise<EmployeeLookup | null>;
  readonly adminEmployees: (
    text: string,
    codes?: readonly string[],
  ) => Promise<EmployeeLookup | null>;
  readonly periodsByRange: (
    from: string,
    to: string,
  ) => Promise<PeriodLookup | null>;
}

/** The record the user is looking at, as the page itself loaded it. */
export interface PageSearchContext {
  readonly page: "hr.review" | "hr.employees" | "hr.period" | "hr.day";
  readonly employee?: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  };
  readonly date?: string;
  readonly period?: {
    readonly id: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly siteCode: string;
    /** The closed version on screen, if any. */
    readonly version?: number;
    /** The newest closed version (0 while never closed). */
    readonly latestClosedVersion?: number;
  };
}

export interface ResolverInput {
  readonly intent: GroundedIntent;
  readonly today: string | null;
  readonly granted: readonly string[];
  /** The member's own linked employee code, if any. */
  readonly ownCode: string | null;
  readonly context: PageSearchContext | null;
  readonly lookups: IntentLookups;
}

export type Choice =
  | {
      readonly kind: "EMPLOYEE";
      readonly target: DestinationTarget;
      readonly employee: EmployeeHit;
      readonly date?: string;
    }
  | {
      readonly kind: "PERIOD";
      readonly target: DestinationTarget;
      readonly period: PeriodHit;
    }
  | {
      readonly kind: "DATE";
      readonly target: DestinationTarget;
      readonly date: string;
    }
  | { readonly kind: "PAGE"; readonly target: DestinationTarget };

export type IntentOutcome =
  | { readonly kind: "NAVIGATE"; readonly target: DestinationTarget }
  | {
      readonly kind: "CHOOSE";
      /** Why the dialog asks: several matches, a name, an inferred year… */
      readonly reason:
        "AMBIGUOUS" | "NAME" | "INFERRED_YEAR" | "NEEDS_DATE" | "INCOMPLETE";
      readonly choices: readonly Choice[];
    }
  | {
      readonly kind: "CLARIFY";
      readonly need:
        | "DATE"
        | "EMPLOYEE"
        /** The model named someone the query does not: never opened. */
        | "EMPLOYEE_UNCONFIRMED"
        | "SITE"
        | "TASK"
        | "RANGE"
        | DateNeed
        | "FUTURE_DATE"
        | VersionNeed;
      readonly suggestions: readonly Choice[];
    }
  | {
      readonly kind: "UNSUPPORTED";
      readonly topic: UnsupportedTopic;
      readonly suggestions: readonly Choice[];
    }
  | { readonly kind: "NO_MATCH"; readonly incomplete: boolean }
  | { readonly kind: "UNAVAILABLE" };

const allowed = (target: DestinationTarget, granted: readonly string[]) =>
  destinationHref(target) !== null &&
  hasNavigationPermission(targetPermissions(target), granted);

const pageChoice = (
  key: StaticDestinationKey,
  granted: readonly string[],
): Choice[] =>
  allowed({ key }, granted) ? [{ kind: "PAGE", target: { key } }] : [];

const UNSUPPORTED_SUGGESTIONS: Readonly<
  Record<UnsupportedTopic, readonly StaticDestinationKey[]>
> = {
  OVERTIME_APPROVAL: ["hr.review", "hr.periods"],
  LEAVE_REQUEST: ["hr.time", "hr.review"],
  PAYROLL: ["hr.task.exportPeriod", "hr.periods"],
  DATA_CHANGE: ["hr.task.correction", "hr.review"],
  OTHER: ["hr.today", "hr.time"],
};

/** Exact code (from the query or the page selection), or why there is none. */
type EmployeeRef =
  | {
      readonly kind: "EXACT";
      readonly code: string;
      /** Every explicit code; more than one is a choice, never a jump. */
      readonly codes: readonly string[];
      /** The selected record's ID, which the lookup must return. */
      readonly id?: string;
    }
  | { readonly kind: "NAME"; readonly name: string }
  /** The model named a person the query does not contain. */
  | { readonly kind: "REJECTED" }
  | { readonly kind: "NONE" };

function employeeRef(input: ResolverInput): EmployeeRef {
  const { intent } = input;
  if (intent.dropped.includes("CODE") || intent.dropped.includes("NAME"))
    return { kind: "REJECTED" };
  const employee = intent.employee;
  if (employee?.ref === "CODE")
    return { kind: "EXACT", code: employee.code, codes: employee.codes };
  if (employee?.ref === "NAME") return { kind: "NAME", name: employee.name };
  if (employee?.ref === "CONTEXT" && input.context?.employee !== undefined)
    return {
      kind: "EXACT",
      code: input.context.employee.code,
      codes: [input.context.employee.code],
      id: input.context.employee.id,
    };
  return { kind: "NONE" };
}

type DateNeed = "DATE_UNSUPPORTED" | "DATE_INVALID" | "DATE_AMBIGUOUS";
type VersionNeed = "VERSION_INVALID" | "VERSION_UNAVAILABLE";

/** Why a written date cannot be used as it stands. */
const dateNeed = (
  problem: NonNullable<GroundedIntent["dateProblem"]>,
): DateNeed =>
  problem === "INVALID"
    ? "DATE_INVALID"
    : problem === "UNSUPPORTED"
      ? "DATE_UNSUPPORTED"
      : "DATE_AMBIGUOUS";

type DateRef =
  | { readonly kind: "EXACT"; readonly date: string }
  | { readonly kind: "INFERRED"; readonly date: string }
  | { readonly kind: "RANGE" }
  | { readonly kind: "PROBLEM"; readonly need: DateNeed }
  | { readonly kind: "NONE" };

function dateRef(input: ResolverInput): DateRef {
  const { intent, context } = input;
  if (intent.dateProblem !== null)
    return {
      kind: "PROBLEM",
      need: dateNeed(intent.dateProblem),
    };
  const date = intent.date;
  if (date?.ref === "DATE")
    return date.inferredYear
      ? { kind: "INFERRED", date: date.date }
      : { kind: "EXACT", date: date.date };
  if (date?.ref === "RANGE") return { kind: "RANGE" };
  if (date?.ref === "CONTEXT" && context?.date !== undefined)
    return { kind: "EXACT", date: context.date };
  return { kind: "NONE" };
}

/** Today and yesterday as explicit choices when a date is missing. */
function recentDates(today: string | null): readonly string[] {
  return today === null ? [] : [today, addDays(today, -1)];
}

const exactHit = (
  lookup: EmployeeLookup,
  ref: Extract<EmployeeRef, { kind: "EXACT" }>,
) =>
  ref.codes.length === 1 &&
  lookup.complete &&
  lookup.items.length === 1 &&
  lookup.items[0]!.match === "CODE" &&
  lookup.items[0]!.code === ref.code &&
  (ref.id === undefined || lookup.items[0]!.id === ref.id)
    ? lookup.items[0]!
    : null;

const isFuture = (date: string, today: string | null) =>
  today !== null && compareDates(date, today) > 0;

async function resolveSelfDay(input: ResolverInput): Promise<IntentOutcome> {
  const { granted, today } = input;
  if (
    !hasNavigationPermission([HR_CODES.self], granted) ||
    input.ownCode === null
  )
    return { kind: "NO_MATCH", incomplete: false };
  const date = dateRef(input);
  const dayChoice = (value: string): Choice => ({
    kind: "DATE",
    date: value,
    target: { key: "hr.selfDay", date: value, focus: "correction" },
  });
  if (date.kind === "PROBLEM")
    return {
      kind: "CLARIFY",
      need: date.need,
      suggestions: recentDates(today).map(dayChoice),
    };
  if (date.kind === "RANGE" || date.kind === "NONE")
    return {
      kind: "CLARIFY",
      need: "DATE",
      suggestions: recentDates(today).map(dayChoice),
    };
  if (isFuture(date.date, today))
    return {
      kind: "CLARIFY",
      need: "FUTURE_DATE",
      suggestions: recentDates(today).map(dayChoice),
    };
  if (date.kind === "INFERRED")
    return {
      kind: "CHOOSE",
      reason: "INFERRED_YEAR",
      choices: [dayChoice(date.date)],
    };
  return {
    kind: "NAVIGATE",
    target: { key: "hr.selfDay", date: date.date, focus: "correction" },
  };
}

async function resolveEmployeeTask(
  input: ResolverInput,
  task: "REVIEW" | "EDIT",
): Promise<IntentOutcome> {
  const permission = task === "REVIEW" ? HR_CODES.review : HR_CODES.admin;
  if (!hasNavigationPermission([permission], input.granted))
    return { kind: "NO_MATCH", incomplete: false };
  const ref = employeeRef(input);
  const date = task === "REVIEW" ? dateRef(input) : ({ kind: "NONE" } as const);
  const focus: EmployeeFocus = input.intent.employeeFocus ?? "details";
  const targetFor = (employee: EmployeeHit, day?: string): DestinationTarget =>
    task === "EDIT"
      ? { key: "hr.employeeEdit", employeeId: employee.id, focus }
      : {
          key: "hr.reviewDay",
          employeeId: employee.id,
          date: day!,
          focus: "decision",
        };
  const pages = pageChoice(
    task === "REVIEW" ? "hr.review" : "hr.employees",
    input.granted,
  );
  if (ref.kind === "REJECTED")
    return {
      kind: "CLARIFY",
      need: "EMPLOYEE_UNCONFIRMED",
      suggestions: pages,
    };
  if (ref.kind === "NONE")
    return { kind: "CLARIFY", need: "EMPLOYEE", suggestions: pages };
  // The day is checked before anyone is looked up, so a future or unusable
  // date never comes back as a list of actionable review targets.
  if (date.kind === "PROBLEM")
    return { kind: "CLARIFY", need: date.need, suggestions: [] };
  if (date.kind === "RANGE")
    return { kind: "CLARIFY", need: "DATE", suggestions: [] };
  if (
    (date.kind === "EXACT" || date.kind === "INFERRED") &&
    isFuture(date.date, input.today)
  )
    return { kind: "CLARIFY", need: "FUTURE_DATE", suggestions: [] };
  const search =
    task === "REVIEW"
      ? input.lookups.reviewEmployees
      : input.lookups.adminEmployees;
  const lookup =
    ref.kind === "EXACT"
      ? await search(ref.codes.join(" "), ref.codes)
      : await search(ref.name);
  if (lookup === null) return { kind: "UNAVAILABLE" };
  if (lookup.items.length === 0)
    return { kind: "NO_MATCH", incomplete: !lookup.complete };

  // Review needs a day: an explicit one, or explicit choices to confirm.
  const reviewDates =
    task === "EDIT"
      ? [undefined]
      : date.kind === "EXACT" || date.kind === "INFERRED"
        ? [date.date]
        : recentDates(input.today);
  const choices: Choice[] = lookup.items.flatMap((employee) =>
    reviewDates.map((day) => ({
      kind: "EMPLOYEE" as const,
      employee,
      target: targetFor(employee, day),
      ...(day === undefined ? {} : { date: day }),
    })),
  );
  if (ref.kind === "NAME") return { kind: "CHOOSE", reason: "NAME", choices };
  const hit = exactHit(lookup, ref);
  if (hit === null)
    return {
      kind: "CHOOSE",
      reason: lookup.complete ? "AMBIGUOUS" : "INCOMPLETE",
      choices,
    };
  if (task === "EDIT") return { kind: "NAVIGATE", target: targetFor(hit) };
  if (date.kind === "EXACT")
    return { kind: "NAVIGATE", target: targetFor(hit, date.date) };
  return {
    kind: "CHOOSE",
    reason: date.kind === "INFERRED" ? "INFERRED_YEAR" : "NEEDS_DATE",
    choices,
  };
}

/** The closed version a period link opens, or why the asked one cannot. */
export function periodVersion(
  requested: GroundedIntent["version"],
  period: {
    readonly status?: string;
    readonly latestClosedVersion?: number;
    readonly version?: number;
  },
): { readonly version?: number } | VersionNeed {
  if (requested.kind === "INVALID") return "VERSION_INVALID";
  if (requested.kind === "ONE") {
    // Closed versions are numbered 1…latest without gaps; a draft has none.
    const latest = period.latestClosedVersion;
    if (latest !== undefined && requested.version > latest)
      return "VERSION_UNAVAILABLE";
    return { version: requested.version };
  }
  if (period.version !== undefined) return { version: period.version };
  return period.status === "CLOSED" && period.latestClosedVersion
    ? { version: period.latestClosedVersion }
    : {};
}

async function resolvePeriod(input: ResolverInput): Promise<IntentOutcome> {
  const { granted, intent, context } = input;
  if (!hasNavigationPermission([HR_CODES.close], granted))
    return { kind: "NO_MATCH", incomplete: false };
  const canExport = hasNavigationPermission([HR_CODES.export], granted);
  const periods = pageChoice("hr.periods", granted);
  const targetFor = (
    id: string,
    version: { readonly version?: number },
  ): DestinationTarget => ({
    key: "hr.period",
    periodId: id,
    ...version,
    ...(canExport ? { focus: "export" as const } : {}),
  });
  // Written evidence first: a date problem or a range in the query always
  // decides, whatever page is open. The selection only answers "this one".
  if (intent.dateProblem !== null)
    return {
      kind: "CLARIFY",
      need: dateNeed(intent.dateProblem),
      suggestions: periods,
    };
  if (intent.version.kind === "INVALID")
    return { kind: "CLARIFY", need: "VERSION_INVALID", suggestions: periods };
  const date = intent.date;
  if (date?.ref !== "RANGE") {
    if (
      date === null &&
      intent.period?.ref === "CONTEXT" &&
      context?.period !== undefined
    ) {
      const version = periodVersion(intent.version, context.period);
      return typeof version === "string"
        ? { kind: "CLARIFY", need: version, suggestions: periods }
        : { kind: "NAVIGATE", target: targetFor(context.period.id, version) };
    }
    return { kind: "CLARIFY", need: "RANGE", suggestions: periods };
  }
  const lookup = await input.lookups.periodsByRange(date.from, date.to);
  if (lookup === null) return { kind: "UNAVAILABLE" };
  if (lookup.items.length === 0)
    return { kind: "NO_MATCH", incomplete: !lookup.complete };
  const choices: Choice[] = lookup.items.flatMap((period) => {
    const version = periodVersion(intent.version, period);
    return typeof version === "string"
      ? []
      : [
          {
            kind: "PERIOD" as const,
            period,
            target: targetFor(period.id, version),
          },
        ];
  });
  // The asked version exists in none of them: say so, never open the latest.
  if (choices.length === 0)
    return {
      kind: "CLARIFY",
      need: "VERSION_UNAVAILABLE",
      suggestions: periods,
    };
  if (
    lookup.items.length === 1 &&
    choices.length === 1 &&
    lookup.complete &&
    !date.inferredYear
  )
    return { kind: "NAVIGATE", target: choices[0]!.target };
  return {
    kind: "CHOOSE",
    reason: date.inferredYear
      ? "INFERRED_YEAR"
      : lookup.complete
        ? "AMBIGUOUS"
        : "INCOMPLETE",
    choices,
  };
}

export async function resolveIntent(
  input: ResolverInput,
): Promise<IntentOutcome> {
  const { intent, granted } = input;
  switch (intent.kind) {
    case "OPEN_PAGE": {
      if (intent.page === null)
        return { kind: "CLARIFY", need: "TASK", suggestions: [] };
      const target = { key: intent.page } as const;
      return allowed(target, granted)
        ? { kind: "NAVIGATE", target }
        : { kind: "NO_MATCH", incomplete: false };
    }
    case "HR_SETTINGS_SECTION": {
      const key: StaticDestinationKey =
        intent.settingsSection === null
          ? "hr.settings"
          : `hr.settings.${intent.settingsSection}`;
      return allowed({ key }, granted)
        ? { kind: "NAVIGATE", target: { key } }
        : { kind: "NO_MATCH", incomplete: false };
    }
    case "SELF_DAY_CORRECTION": {
      // Someone else written in the query turns this into a review; a
      // person the model invented, or a code it ignored, is never "me".
      const employee = employeeRef(input);
      if (employee.kind === "REJECTED")
        return {
          kind: "CLARIFY",
          need: "EMPLOYEE_UNCONFIRMED",
          suggestions: pageChoice("hr.task.correction", granted),
        };
      if (
        employee.kind === "NAME" ||
        (employee.kind === "EXACT" &&
          (employee.code !== input.ownCode || employee.codes.length > 1))
      )
        return resolveEmployeeTask(input, "REVIEW");
      if (
        employee.kind === "NONE" &&
        intent.queryCodes.some((code) => code !== input.ownCode)
      )
        return {
          kind: "CLARIFY",
          need: "EMPLOYEE_UNCONFIRMED",
          suggestions: pageChoice("hr.task.correction", granted),
        };
      return resolveSelfDay(input);
    }
    case "TEAM_DAY_REVIEW":
      return resolveEmployeeTask(input, "REVIEW");
    case "EMPLOYEE_EDIT":
      return resolveEmployeeTask(input, "EDIT");
    case "PERIOD_EXPORT":
      return resolvePeriod(input);
    case "CLARIFY": {
      const need = intent.clarify ?? "TASK";
      const keys: readonly StaticDestinationKey[] =
        need === "DATE"
          ? ["hr.task.correction", "hr.task.reviewDay"]
          : need === "EMPLOYEE"
            ? ["hr.review", "hr.employees"]
            : need === "SITE"
              ? ["hr.review", "hr.periods"]
              : ["hr.today", "hr.time", "hr.review"];
      return {
        kind: "CLARIFY",
        need,
        suggestions: keys.flatMap((key) => pageChoice(key, granted)),
      };
    }
    case "UNSUPPORTED": {
      const topic = intent.unsupportedTopic ?? "OTHER";
      return {
        kind: "UNSUPPORTED",
        topic,
        suggestions: UNSUPPORTED_SUGGESTIONS[topic].flatMap((key) =>
          pageChoice(key, granted),
        ),
      };
    }
  }
}
