/**
 * The AI navigation contract: what a model may answer, how the answer is
 * validated, and how it is grounded in the user's own words.
 *
 * The model only classifies a request into an allowlisted intent and copies
 * spans from the query. It never returns a URL, selector, code to run,
 * mutation or record ID. Grounding then keeps a code only when it is a token
 * of the original query, a name only when it occurs in the query, reads
 * dates and versions from the query with deterministic parsers, and uses
 * the page selection only when the query refers to it — never on the
 * model's word. A model that invents `EMP-999` or "8 Oct" therefore cannot
 * select a person or a day even if such a record happens to exist.
 */
import type { IsoDate } from "../hr/calendar";
import { fail, ok, type Result } from "../result";
import { isSelfWord, readReferences, type VersionReading } from "./references";
import {
  MAX_SEARCH_TEXT,
  containsNormalized,
  normalizeSearchText,
} from "./text";

export const INTENT_KINDS = [
  "OPEN_PAGE",
  "HR_SETTINGS_SECTION",
  "SELF_DAY_CORRECTION",
  "TEAM_DAY_REVIEW",
  "EMPLOYEE_EDIT",
  "PERIOD_EXPORT",
  "CLARIFY",
  "UNSUPPORTED",
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

/** Static pages the model may name. The client registry maps each to a route. */
export const PAGE_KEYS = [
  "planner.finishedGoods",
  "planner.newProduct",
  "planner.jobScan",
  "planner.jobScanRecords",
  "planner.storageLayouts",
  "planner.newBuilding",
  "planner.setup",
  "hr.today",
  "hr.time",
  "hr.profile",
  "hr.review",
  "hr.employees",
  "hr.newEmployee",
  "hr.periods",
  "hr.settings",
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

export const SETTINGS_SECTIONS = ["holidays", "access", "policy"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const EMPLOYEE_FOCUS = ["schedule", "details"] as const;
export type EmployeeFocus = (typeof EMPLOYEE_FOCUS)[number];

export const CLARIFY_NEEDS = ["DATE", "EMPLOYEE", "SITE", "TASK"] as const;
export type ClarifyNeed = (typeof CLARIFY_NEEDS)[number];

export const UNSUPPORTED_TOPICS = [
  "OVERTIME_APPROVAL",
  "LEAVE_REQUEST",
  "PAYROLL",
  "DATA_CHANGE",
  "OTHER",
] as const;
export type UnsupportedTopic = (typeof UNSUPPORTED_TOPICS)[number];

/** Pages whose selected record the user may refer to as "this" / "ตรงนี้". */
export const CONTEXT_PAGES = [
  "hr.review",
  "hr.employees",
  "hr.period",
  "hr.day",
] as const;
export type ContextPage = (typeof CONTEXT_PAGES)[number];

/**
 * What the server learns about the page: its key and whether a record is
 * selected. Codes, names and dates of the selection stay in the browser.
 */
export interface IntentContextFlags {
  readonly page: ContextPage | null;
  readonly employee: boolean;
  readonly date: boolean;
  readonly period: boolean;
}

export const NO_CONTEXT: IntentContextFlags = Object.freeze({
  page: null,
  employee: false,
  date: false,
  period: false,
});

/** The model's answer after strict validation; still ungrounded. */
export interface ModelIntent {
  readonly kind: IntentKind;
  readonly page: PageKey | null;
  readonly settingsSection: SettingsSection | null;
  readonly employeeFocus: EmployeeFocus | null;
  readonly employeeCode: string | null;
  readonly employeeName: string | null;
  readonly dateText: string | null;
  readonly useContextEmployee: boolean;
  readonly useContextDate: boolean;
  readonly useContextPeriod: boolean;
  readonly clarify: ClarifyNeed | null;
  readonly unsupportedTopic: UnsupportedTopic | null;
}

const nullableEnum = (values: readonly string[]) => ({
  type: ["string", "null"],
  enum: [...values, null],
});
const nullableText = { type: ["string", "null"], maxLength: 120 };

/** Strict JSON schema sent to the provider (all keys required). */
export const INTENT_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "page",
    "settingsSection",
    "employeeFocus",
    "employeeCode",
    "employeeName",
    "dateText",
    "useContextEmployee",
    "useContextDate",
    "useContextPeriod",
    "clarify",
    "unsupportedTopic",
  ],
  properties: {
    kind: { type: "string", enum: [...INTENT_KINDS] },
    page: nullableEnum(PAGE_KEYS),
    settingsSection: nullableEnum(SETTINGS_SECTIONS),
    employeeFocus: nullableEnum(EMPLOYEE_FOCUS),
    employeeCode: nullableText,
    employeeName: nullableText,
    dateText: nullableText,
    useContextEmployee: { type: "boolean" },
    useContextDate: { type: "boolean" },
    useContextPeriod: { type: "boolean" },
    clarify: nullableEnum(CLARIFY_NEEDS),
    unsupportedTopic: nullableEnum(UNSUPPORTED_TOPICS),
  },
});

const MODEL_KEYS = INTENT_JSON_SCHEMA.required;

export type IntentParseError = "AI_UNREADABLE";

const oneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && values.includes(value as T);

/** Validate a provider answer exactly; unknown keys or values are refused. */
export function parseModelIntent(
  value: unknown,
): Result<ModelIntent, IntentParseError> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return fail("AI_UNREADABLE");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== [...MODEL_KEYS].sort().join(","))
    return fail("AI_UNREADABLE");
  const text = (field: unknown) =>
    field === null ||
    (typeof field === "string" && field.length <= 120 && field.trim() !== "");
  const nullableOneOf = <T extends string>(values: readonly T[], v: unknown) =>
    v === null || oneOf(values, v);
  if (
    !oneOf(INTENT_KINDS, record.kind) ||
    !nullableOneOf(PAGE_KEYS, record.page) ||
    !nullableOneOf(SETTINGS_SECTIONS, record.settingsSection) ||
    !nullableOneOf(EMPLOYEE_FOCUS, record.employeeFocus) ||
    !nullableOneOf(CLARIFY_NEEDS, record.clarify) ||
    !nullableOneOf(UNSUPPORTED_TOPICS, record.unsupportedTopic) ||
    !text(record.employeeCode) ||
    !text(record.employeeName) ||
    !text(record.dateText) ||
    typeof record.useContextEmployee !== "boolean" ||
    typeof record.useContextDate !== "boolean" ||
    typeof record.useContextPeriod !== "boolean"
  )
    return fail("AI_UNREADABLE");
  return ok(record as unknown as ModelIntent);
}

export type GroundedEmployee =
  | {
      readonly ref: "CODE";
      readonly code: string;
      /**
       * Every explicit code of the query with the chosen one first; more
       * than one is never auto-opened.
       */
      readonly codes: readonly string[];
    }
  | { readonly ref: "NAME"; readonly name: string }
  | { readonly ref: "CONTEXT" };

export type GroundedDate =
  | {
      readonly ref: "DATE";
      readonly date: IsoDate;
      /** Written without a year: shown for confirmation, never auto-opened. */
      readonly inferredYear: boolean;
    }
  | {
      readonly ref: "RANGE";
      readonly from: IsoDate;
      readonly to: IsoDate;
      readonly inferredYear: boolean;
    }
  | { readonly ref: "CONTEXT" };

export type DateProblem =
  "AMBIGUOUS" | "INVALID" | "UNSUPPORTED" | "CONFLICT" | "NO_CLOCK";

/** A model value that grounding refused; reported, never used. */
export type DroppedValue = "CODE" | "NAME" | "DATE" | "CONTEXT";

export interface GroundedIntent {
  readonly kind: IntentKind;
  readonly page: PageKey | null;
  readonly settingsSection: SettingsSection | null;
  readonly employeeFocus: EmployeeFocus | null;
  readonly employee: GroundedEmployee | null;
  readonly date: GroundedDate | null;
  readonly period: { readonly ref: "CONTEXT" } | null;
  readonly dateProblem: DateProblem | null;
  /** An explicit period version read from the query, never from the model. */
  readonly version: VersionReading;
  /**
   * Explicit employee codes with a digit in the query, whatever the model
   * answered, so a request naming someone else is never the actor's own.
   */
  readonly queryCodes: readonly string[];
  readonly dropped: readonly DroppedValue[];
  readonly clarify: ClarifyNeed | null;
  readonly unsupportedTopic: UnsupportedTopic | null;
}

/**
 * Keep only what the query or an explicitly referenced page selection
 * supports.
 *
 * - A code must be a whole explicit token of the query (`A`, `12`, `NIGHT`
 *   and `EMP-1` alike), a name a real span of it. Dates and the version are
 *   read from the query by deterministic parsers; the model's `dateText`
 *   only has to be a real span and is otherwise reported as dropped.
 * - The page selection is used only when the query itself refers to it
 *   ("this", "ตรงนี้", "รายการนี้"); the model's `useContext*` flags are
 *   not evidence. Written evidence always wins: an employee code or name,
 *   or a date, makes the selection irrelevant for that part, and a value
 *   the model invented (dropped) is never replaced by the selection.
 */
export function groundIntent(
  model: ModelIntent,
  input: {
    readonly query: string;
    readonly today: IsoDate | null;
    readonly context: IntentContextFlags;
  },
): GroundedIntent {
  const { query, context } = input;
  const refs = readReferences(query, input.today);
  // Codes with a digit are people however they are written; a word in
  // capitals (`NIGHT`, `HQ`) is one only when the model chose it.
  const numbered = refs.codes.filter((code) => /\d/.test(code));
  const dropped = new Set<DroppedValue>();

  let employee: GroundedEmployee | null = null;
  if (model.employeeCode !== null) {
    const code = normalizeSearchText(model.employeeCode).toUpperCase();
    if (refs.tokens.includes(code))
      employee = {
        ref: "CODE",
        code,
        codes: [code, ...numbered.filter((other) => other !== code)],
      };
    else dropped.add("CODE");
  }
  if (model.employeeName !== null && !isSelfWord(model.employeeName)) {
    const name = model.employeeName.trim();
    if (
      normalizeSearchText(name).length >= 2 &&
      containsNormalized(query, name)
    ) {
      employee ??= { ref: "NAME", name: normalizeSearchText(name) };
    } else dropped.add("NAME");
  }
  // Any written (or invented) person rules out "this one".
  const employeeEvidence =
    employee !== null ||
    dropped.has("CODE") ||
    dropped.has("NAME") ||
    numbered.length > 0;
  const selection = (selected: boolean) => refs.selection && selected;
  if (employee === null && !employeeEvidence && selection(context.employee))
    employee = { ref: "CONTEXT" };
  if (model.useContextEmployee && employee?.ref !== "CONTEXT")
    dropped.add("CONTEXT");

  let date: GroundedDate | null = null;
  let dateProblem: DateProblem | null = null;
  if (model.dateText !== null && !containsNormalized(query, model.dateText))
    dropped.add("DATE");
  const reading = refs.dates;
  if (reading.kind === "ONE") {
    const mention = reading.mention;
    if (mention.kind === "DATE")
      date = {
        ref: "DATE",
        date: mention.date,
        inferredYear: mention.inferredYear,
      };
    else if (mention.kind === "RANGE")
      date = {
        ref: "RANGE",
        from: mention.from,
        to: mention.to,
        inferredYear: mention.inferredYear,
      };
    else
      dateProblem =
        input.today === null && mention.kind === "AMBIGUOUS"
          ? "NO_CLOCK"
          : mention.kind;
  } else if (reading.kind === "CONFLICT") {
    dateProblem = "CONFLICT";
  } else if (reading.kind === "UNSUPPORTED") {
    dateProblem = "UNSUPPORTED";
  } else if (model.dateText !== null && !dropped.has("DATE")) {
    // The model saw a date in words the parser does not support.
    dateProblem = "UNSUPPORTED";
  }
  const dateEvidence =
    date !== null || dateProblem !== null || dropped.has("DATE");
  // The selected day belongs to the selected person: it is only "this day"
  // when no other person is written.
  if (!dateEvidence && !employeeEvidence && selection(context.date))
    date = { ref: "CONTEXT" };
  if (model.useContextDate && date?.ref !== "CONTEXT") dropped.add("CONTEXT");

  let period: GroundedIntent["period"] = null;
  if (!dateEvidence && selection(context.period)) period = { ref: "CONTEXT" };
  if (model.useContextPeriod && period === null) dropped.add("CONTEXT");

  return {
    kind: model.kind,
    page: model.page,
    settingsSection: model.settingsSection,
    employeeFocus: model.employeeFocus,
    employee,
    date,
    period,
    dateProblem,
    version: refs.version,
    queryCodes: numbered,
    dropped: [...dropped],
    clarify: model.clarify,
    unsupportedTopic: model.unsupportedTopic,
  };
}

/** Accepts the query only when it is a real, bounded request. */
export function validQuery(query: unknown): query is string {
  return (
    typeof query === "string" &&
    query.trim().length >= 2 &&
    query.length <= MAX_SEARCH_TEXT
  );
}

export function parseContextFlags(value: unknown): IntentContextFlags {
  if (value === null || typeof value !== "object") return NO_CONTEXT;
  const record = value as Record<string, unknown>;
  const page = oneOf(CONTEXT_PAGES, record.page) ? record.page : null;
  return {
    page,
    employee: page !== null && record.employee === true,
    date: page !== null && record.date === true,
    period: page !== null && record.period === true,
  };
}
