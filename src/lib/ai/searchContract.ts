import type { Static, TSchema } from "@sinclair/typebox";
import { t } from "elysia";

import {
  CLARIFY_NEEDS,
  CONTEXT_PAGES,
  EMPLOYEE_FOCUS,
  INTENT_KINDS,
  PAGE_KEYS,
  SETTINGS_SECTIONS,
  UNSUPPORTED_TOPICS,
} from "../../../convex/model/search/intent";
import { MAX_SEARCH_TEXT } from "../../../convex/model/search/text";

const literals = t.UnionEnum;
// Keep the domain's readonly arrays in Eden's types; retain the Array validator.
const array = <Schema extends TSchema>(schema: Schema) =>
  t.Unsafe<readonly Static<Schema>[]>(t.Array(schema));
const nullable = <Schema extends Parameters<typeof t.Nullable>[0]>(
  schema: Schema,
) => t.Nullable(schema);
const contextReference = t.Object({ ref: t.Literal("CONTEXT") });
const date = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

export const searchRequest = t.Object({
  query: t.String({ minLength: 1, maxLength: MAX_SEARCH_TEXT }),
  context: t.Object({
    page: nullable(literals(CONTEXT_PAGES)),
    employee: t.Boolean(),
    date: t.Boolean(),
    period: t.Boolean(),
  }),
});

const groundedIntent = t.Object({
  kind: literals(INTENT_KINDS),
  page: nullable(literals(PAGE_KEYS)),
  settingsSection: nullable(literals(SETTINGS_SECTIONS)),
  employeeFocus: nullable(literals(EMPLOYEE_FOCUS)),
  employee: nullable(
    t.Union([
      t.Object({
        ref: t.Literal("CODE"),
        code: t.String(),
        codes: array(t.String()),
      }),
      t.Object({ ref: t.Literal("NAME"), name: t.String() }),
      contextReference,
    ]),
  ),
  date: nullable(
    t.Union([
      t.Object({ ref: t.Literal("DATE"), date, inferredYear: t.Boolean() }),
      t.Object({
        ref: t.Literal("RANGE"),
        from: date,
        to: date,
        inferredYear: t.Boolean(),
      }),
      contextReference,
    ]),
  ),
  period: nullable(contextReference),
  dateProblem: nullable(
    literals(["AMBIGUOUS", "INVALID", "UNSUPPORTED", "CONFLICT", "NO_CLOCK"]),
  ),
  version: t.Union([
    t.Object({ kind: t.Literal("NONE") }),
    t.Object({ kind: t.Literal("ONE"), version: t.Integer({ minimum: 1 }) }),
    t.Object({ kind: t.Literal("INVALID") }),
  ]),
  queryCodes: array(t.String()),
  dropped: array(literals(["CODE", "NAME", "DATE", "CONTEXT"])),
  clarify: nullable(literals(CLARIFY_NEEDS)),
  unsupportedTopic: nullable(literals(UNSUPPORTED_TOPICS)),
});

export const searchResponse = t.Object({
  ok: t.Literal(true),
  requestId: t.String(),
  value: t.Union([
    t.Object({
      ok: t.Literal(true),
      today: nullable(date),
      intent: groundedIntent,
    }),
    t.Object({
      ok: t.Literal(false),
      code: literals([
        "AI_UNAVAILABLE",
        "AI_TIMEOUT",
        "AI_UNREADABLE",
        "QUERY_INVALID",
      ]),
    }),
    t.Object({
      ok: t.Literal(false),
      code: t.Literal("RATE_LIMITED"),
      retryAfterMs: t.Number({ minimum: 0 }),
    }),
  ]),
});

export const searchDenied = t.Object({
  ok: t.Literal(false),
  requestId: t.String(),
  denial: t.Object({
    kind: t.Literal("AUTHORIZATION_DENIED"),
    code: t.Literal("AUTHORIZATION_DENIED"),
    requestId: t.String(),
    message: t.String(),
  }),
});

export const searchHttpError = t.Object({
  code: literals(["DENIED", "QUERY_INVALID", "FAILED"]),
});
