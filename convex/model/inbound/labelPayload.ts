import { fail, ok, type Result } from "../result";

export type LabelPayloadError =
  | { readonly code: "TEMPLATE_EMPTY" }
  | { readonly code: "TEMPLATE_NOT_PUBLISHED"; readonly status: string }
  | { readonly code: "PLACEHOLDER_MALFORMED"; readonly position: number }
  | { readonly code: "MISSING_FIELD"; readonly field: string }
  | { readonly code: "FIELD_NAME_INVALID"; readonly field: string }
  | { readonly code: "FIELD_VALUE_INVALID"; readonly field: string }
  | { readonly code: "PAYLOAD_TOO_LARGE"; readonly limit: number }
  | { readonly code: "VERSION_INVALID" };

export const MAX_PAYLOAD_LENGTH = 32_768;

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const FIELD_NAME = /^[A-Z][A-Z0-9_]{0,39}$/;

const FORBIDDEN_VALUE = /[{}\u0000-\u0008\u000a-\u001f\u007f]/;

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

  readonly payload: string;

  readonly canonicalText: string;

  readonly fieldsUsed: readonly string[];
}

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

export type PrintJobStatus = "GENERATED" | "DISPATCHED" | "FAILED";

export const LOCALLY_REACHABLE_STATUSES: readonly PrintJobStatus[] =
  Object.freeze(["GENERATED"]);

export type PrintReason = "INITIAL" | "REPRINT" | "PREVIEW";

export const requiresReprintPermission = (reason: PrintReason): boolean =>
  reason === "REPRINT";
