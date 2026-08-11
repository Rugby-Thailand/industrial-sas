/**
 * Turning a stored label template into the exact bytes a printer *would* receive.
 *
 * The honest boundary of this module is the whole point of it, so it is stated
 * first and it is not softened anywhere below:
 *
 * - This repository has **no printer transport**. That is `INT-04` and it does
 *   not exist.
 * - No label produced here has ever been **physically printed or rescanned**.
 *   That is `RG-004` / `RG-029` and it has not happened.
 * - Nothing here renders a PDF. `pdf-lib` is installed and unused; a PDF
 *   *fallback* is `ADR-0007` §10's requirement and it is not implemented.
 *
 * What this module does is the part that is entirely local and entirely
 * verifiable: substitute a template's fields, produce a deterministic payload,
 * and hand the caller a canonical text to hash. The version and the hash are the
 * audit evidence `INV-0007-07` requires — the claim being recorded is "this
 * payload was generated from template version N", which is true, and not "this
 * label was printed", which would not be.
 *
 * ### Why substitution is refusal-oriented rather than lenient
 *
 * A template placeholder with no value could render as an empty string, and a
 * label with a blank lot code looks exactly like a label with a correct one from
 * two metres away on a forklift. So an unfilled placeholder is an error, not a
 * gap: `MISSING_FIELD` names the placeholder and refuses to produce a payload.
 *
 * No clock, no database, no Convex import (plan §6.2).
 */
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type LabelPayloadError =
  | { readonly code: "TEMPLATE_EMPTY" }
  | { readonly code: "TEMPLATE_NOT_PUBLISHED"; readonly status: string }
  | { readonly code: "PLACEHOLDER_MALFORMED"; readonly position: number }
  | { readonly code: "MISSING_FIELD"; readonly field: string }
  | { readonly code: "FIELD_NAME_INVALID"; readonly field: string }
  | { readonly code: "FIELD_VALUE_INVALID"; readonly field: string }
  | { readonly code: "PAYLOAD_TOO_LARGE"; readonly limit: number }
  | { readonly code: "VERSION_INVALID" };

/**
 * The longest payload this repository will store.
 *
 * A ZPL label is a few hundred bytes. The bound exists because the payload is
 * retained as evidence and an unbounded evidence column is an unbounded write.
 */
export const MAX_PAYLOAD_LENGTH = 32_768;

/** Placeholders are `{{NAME}}`; names are code identifiers and stay English (`D-06`). */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const FIELD_NAME = /^[A-Z][A-Z0-9_]{0,39}$/;

/**
 * Characters a field value may not contain.
 *
 * `{` and `}` are excluded so a value can never introduce a placeholder: a lot
 * code of `{{PRICE}}` must not cause a second substitution pass to interpolate
 * something the template never asked for. Control characters other than tab are
 * excluded because they change how a printer parses the stream.
 */
const FORBIDDEN_VALUE = /[{}\u0000-\u0008\u000a-\u001f\u007f]/;

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

export interface LabelTemplateSource {
  readonly code: string;
  readonly version: number;
  readonly format: string;
  readonly status: string;
  readonly body: string;
}

export interface RenderedLabel {
  readonly templateCode: string;
  readonly templateVersion: number;
  readonly format: string;
  /** The payload as a printer would receive it. Never transmitted anywhere. */
  readonly payload: string;
  /**
   * The exact text to hash for the evidence record.
   *
   * Deliberately *not* the payload alone: two different template versions can
   * render byte-identical payloads when every substituted field happens to
   * match, and an evidence hash that could not tell them apart would defeat the
   * versioning it exists to prove (`INV-0007-07`).
   */
  readonly canonicalText: string;
  /** The placeholders that were filled, sorted, for the audit row. */
  readonly fieldsUsed: readonly string[];
}

/**
 * Render one template with one set of field values.
 *
 * Only an `ACTIVE` template renders. A `DRAFT` has not been published — which
 * requires a second person (`INV-0006-05`) — and a `RETIRED` one is kept so an
 * old label can be traced, not so new ones can be made from it.
 */
export function renderLabel(input: {
  readonly template: LabelTemplateSource;
  readonly fields: Readonly<Record<string, string>>;
}): Result<RenderedLabel, LabelPayloadError> {
  const { template } = input;

  if (!Number.isSafeInteger(template.version) || template.version < 1) {
    return fail({ code: "VERSION_INVALID" });
  }
  if (template.status !== "ACTIVE") {
    return fail({
      code: "TEMPLATE_NOT_PUBLISHED",
      status: String(template.status),
    });
  }
  if (template.body.trim().length === 0) {
    return fail({ code: "TEMPLATE_EMPTY" });
  }

  for (const [name, value] of Object.entries(input.fields)) {
    if (!FIELD_NAME.test(name)) {
      return fail({ code: "FIELD_NAME_INVALID", field: name });
    }
    if (typeof value !== "string" || FORBIDDEN_VALUE.test(value)) {
      return fail({ code: "FIELD_VALUE_INVALID", field: name });
    }
  }

  /*
   * A lone brace is refused rather than passed through. `{{LOT` is far more
   * likely to be a template someone mistyped than a printer command, and
   * printing a label with a literal `{{LOT` on it is a wasted label at best.
   */
  const stray = template.body.indexOf("{{");
  if (stray >= 0 && !PLACEHOLDER.test(template.body)) {
    PLACEHOLDER.lastIndex = 0;
    return fail({ code: "PLACEHOLDER_MALFORMED", position: stray });
  }
  PLACEHOLDER.lastIndex = 0;

  const used = new Set<string>();
  let missing: string | undefined;

  const payload = template.body.replace(PLACEHOLDER, (_match, rawName) => {
    const name = String(rawName).trim();
    const value = input.fields[name];
    if (value === undefined) {
      missing ??= name;
      return "";
    }
    used.add(name);
    return value;
  });

  if (missing !== undefined) {
    // A blank lot code looks exactly like a correct one from two metres away.
    return fail({ code: "MISSING_FIELD", field: missing });
  }
  if (payload.length > MAX_PAYLOAD_LENGTH) {
    return fail({ code: "PAYLOAD_TOO_LARGE", limit: MAX_PAYLOAD_LENGTH });
  }

  const fieldsUsed = [...used].sort();

  return ok(
    Object.freeze({
      templateCode: template.code,
      templateVersion: template.version,
      format: template.format,
      payload,
      canonicalText: canonicalTextFor({
        code: template.code,
        version: template.version,
        format: template.format,
        payload,
      }),
      fieldsUsed: Object.freeze(fieldsUsed),
    }),
  );
}

/**
 * The text an evidence hash is taken over.
 *
 * Newline-separated and prefixed with the template identity, so the hash proves
 * *which version produced these bytes* rather than only what the bytes were. The
 * separator is a character the field validator forbids inside a value, so no
 * combination of values can forge a different framing.
 */
export function canonicalTextFor(input: {
  readonly code: string;
  readonly version: number;
  readonly format: string;
  readonly payload: string;
}): string {
  return [
    `template:${input.code}`,
    `version:${input.version}`,
    `format:${input.format}`,
    "payload:",
    input.payload,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Print-job lifecycle                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What a print job can honestly be said to be.
 *
 * There is no `PRINTED`, and its absence is the design. Nothing in this
 * repository can observe a printer, so a status claiming a label came out of one
 * would be a claim no code here is in a position to make.
 *
 * - `GENERATED` — the payload exists and its hash is recorded. True today.
 * - `DISPATCHED` — handed to a transport. Unreachable until `INT-04` exists;
 *   declared so the state machine is complete rather than retrofitted.
 * - `FAILED` — a transport refused it. Also unreachable today.
 */
export type PrintJobStatus = "GENERATED" | "DISPATCHED" | "FAILED";

/** The statuses a job may reach without a printer transport. */
export const LOCALLY_REACHABLE_STATUSES: readonly PrintJobStatus[] =
  Object.freeze(["GENERATED"]);

/**
 * Why a payload was generated.
 *
 * A reprint is a distinct reason rather than a second `INITIAL`, because
 * `ADR-0007` §10 requires reprints to be audited *as reprints*: three labels for
 * one pallet is either three attempts at a jammed printer or a label being
 * applied to stock that has moved, and the two need to be tellable apart.
 */
export type PrintReason = "INITIAL" | "REPRINT" | "PREVIEW";

/** Whether this reason needs `label.print.reprint` rather than `label.print.execute`. */
export const requiresReprintPermission = (reason: PrintReason): boolean =>
  reason === "REPRINT";
