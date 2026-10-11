// Only these fixed codes may leave a credential-bearing smoke process.
// Never copy provider messages, stack traces, URLs, IDs or field values.
const INPUTS = new Map(
  [
    "SMOKE_BASE_URL",
    "SMOKE_TARGET",
    "CLERK_SECRET_KEY",
    "CONVEX_DEPLOY_KEY",
    "CONVEX_DEPLOYMENT",
    "CONVEX_ADMIN_KEY",
    "CONVEX_BACKUP_ADMIN_KEY",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "CONVEX_SELF_HOSTED_URL",
    "CLERK_API_URL",
    "CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CONVEX_URL",
    "NEXT_PUBLIC_CONVEX_URL",
    "GITHUB_REPOSITORY",
    "GITHUB_REF",
    "GITHUB_EVENT_NAME",
    "GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT",
    "STAGING_E2E_LOCAL_REHEARSAL",
  ].map((field) => [
    field,
    `STAGING_INPUT_${field.replaceAll("/", "_")}_INVALID`,
  ]),
);
const STEPS = [
  "CLERK_INSTANCE",
  "TESTING_TOKEN",
  "OWNERSHIP_STATE",
  "USER_CREATE",
  "PRIMARY_ORGANIZATION_CREATE",
  "OTHER_ORGANIZATION_CREATE",
  "MEMBERSHIP_READ",
  "IDENTITY_WEBHOOKS",
  "BACKEND_PREPARE",
  "FIXTURE_READBACK",
];
const HTTP_STATUSES = [400, 401, 403, 404, 422, 429, 500, 502, 503, 504];
const CLERK_CODES = new Map(
  [
    "form_param_format_invalid",
    "form_param_value_invalid",
    "form_param_missing",
    "form_identifier_exists",
    "form_password_pwned",
    "user_limit_exceeded",
    "api_key_invalid",
    "authorization_invalid",
    "resource_forbidden",
    "feature_not_enabled",
    "request_rate_limit_exceeded",
  ].map((code) => [code, `STAGING_CLERK_${code.toUpperCase()}`]),
);
const FIXED_CODES = [
  "SENSITIVE_SMOKE_PAGE_ERRORS",
  "SENSITIVE_SMOKE_UNCAUGHT_ERRORS",
  "SENSITIVE_SMOKE_NETWORK_ERRORS",
  "SENSITIVE_SMOKE_CONSOLE_ERRORS",
  "SMOKE_PROTECTION_REQUEST_FAILED",
  "SMOKE_PROTECTION_SETUP_FAILED",
  "STAGING_PROTECTION_TOKEN_UNAVAILABLE",
  "STAGING_PROTECTION_ORIGIN_INVALID",
  "STAGING_SIGN_IN_TESTING_TOKEN_FAILED",
  "STAGING_SIGN_IN_NAVIGATION_FAILED",
  "STAGING_SIGN_IN_LOAD_FAILED",
  "STAGING_SIGN_IN_TICKET_FAILED",
  "STAGING_SIGN_IN_IDENTITY_UNCONFIRMED",
  "STAGING_SIGN_IN_ORGANIZATION_FAILED",
  "STAGING_SIGN_IN_WAREHOUSE_CACHE_FAILED",
  "STAGING_AUTH_CONTEXT_NAVIGATION_FAILED",
  "STAGING_AUTH_CONTEXT_PAGE_UNCONFIRMED",
  "STAGING_AUTH_CONTEXT_QUERY_FAILED",
  "STAGING_AUTH_CONTEXT_RESULT_UNCONFIRMED",
  "STAGING_SIGNOUT_NAVIGATION_FAILED",
  "STAGING_SIGNOUT_SDK_FAILED",
  "STAGING_SIGNOUT_REVISIT_FAILED",
  "STAGING_SIGNOUT_ROUTE_UNCONFIRMED",
  "STAGING_SETUP_FAILED",
  "STAGING_SETUP_FAILED_OWNERSHIP_RECORD_RETAINED",
  "STAGING_CLEANUP_INCOMPLETE_OWNERSHIP_RECORD_RETAINED",
  "STAGING_CLERK_INSTANCE_REFUSED",
  "STAGING_OWNERSHIP_RECORD_ALREADY_EXISTS",
  "STAGING_CONVEX_COMMAND_FAILED",
  "STAGING_CONVEX_RESULT_INVALID",
  "STAGING_REAL_IDENTITY_WEBHOOKS_UNCONFIRMED",
  "STAGING_MEMBERSHIP_OWNERSHIP_REFUSED",
  "STAGING_PREPARE_RESULT_INVALID",
  "STAGING_FIXTURE_NOT_READY",
];
const SAFE_CODES = new Set([
  ...INPUTS.values(),
  ...STEPS.map((step) => `STAGING_SETUP_${step}_FAILED`),
  ...HTTP_STATUSES.map((status) => `STAGING_PROVIDER_HTTP_${status}`),
  ...CLERK_CODES.values(),
  ...FIXED_CODES,
]);

// Network diagnostic metadata for SENSITIVE_SMOKE_NETWORK_ERRORS. Each code
// names only an observed origin class, outcome and resource class from these
// fixed lists. They are categories seen during a failing test, not proof of
// which request caused the failure.
const NETWORK_ERRORS = "SENSITIVE_SMOKE_NETWORK_ERRORS";
const NETWORK_PREFIX = "SENSITIVE_SMOKE_NETWORK_";
const NETWORK_ORIGINS = ["APP", "CLERK", "CONVEX", "OTHER"];
const NETWORK_OUTCOMES = [
  ...HTTP_STATUSES.map((status) => `HTTP_${status}`),
  "HTTP_4XX",
  "HTTP_5XX",
  ...["CANCELLED", "DNS", "CONNECTION", "TLS", "TIMEOUT", "OTHER"].map(
    (failure) => `FAILED_${failure}`,
  ),
];
const NETWORK_RESOURCES = [
  "DOCUMENT",
  "STYLESHEET",
  "IMAGE",
  "MEDIA",
  "FONT",
  "SCRIPT",
  "XHR",
  "FETCH",
  "EVENTSOURCE",
  "WEBSOCKET",
  "MANIFEST",
  "OTHER",
];
const NETWORK_CODES = new Set(
  NETWORK_ORIGINS.flatMap((origin) =>
    NETWORK_OUTCOMES.flatMap((outcome) =>
      NETWORK_RESOURCES.map(
        (resource) => `${NETWORK_PREFIX}${origin}_${outcome}_${resource}`,
      ),
    ),
  ),
);
/** Upper bound on network codes attached to one failure message. */
export const MAX_NETWORK_DIAGNOSTICS = 8;
// Network codes are reportable, but are accepted from an error message only
// inside the exact network compound below, never bare or in other prefixes.
const REPORTABLE_CODES = new Set([...SAFE_CODES, ...NETWORK_CODES]);

/**
 * Exact HTTP outcome token for an error status: a reviewed status, else a
 * bounded 4XX/5XX bucket. Non-error or malformed statuses yield undefined.
 * @param {unknown} status
 */
export function networkHttpOutcome(status) {
  if (!Number.isInteger(status) || status < 400 || status > 599)
    return undefined;
  return HTTP_STATUSES.includes(status)
    ? `HTTP_${status}`
    : status < 500
      ? "HTTP_4XX"
      : "HTTP_5XX";
}

/**
 * The exact network code for fixed tokens, or undefined for anything else.
 * @param {unknown} origin
 * @param {unknown} outcome
 * @param {unknown} resource
 */
export function networkDiagnosticCode(origin, outcome, resource) {
  const code = `${NETWORK_PREFIX}${origin}_${outcome}_${resource}`;
  return NETWORK_ORIGINS.includes(origin) &&
    NETWORK_OUTCOMES.includes(outcome) &&
    NETWORK_RESOURCES.includes(resource) &&
    NETWORK_CODES.has(code)
    ? code
    : undefined;
}

/**
 * The fixture's network failure message: the bare fixed code without
 * metadata, else `SENSITIVE_SMOKE_NETWORK_ERRORS: CODE, CODE` with at most
 * MAX_NETWORK_DIAGNOSTICS unique exact codes. Unknown entries are dropped.
 * @param {Iterable<unknown>} codes
 */
export function networkErrorsMessage(codes) {
  const safe = [...new Set(codes)]
    .filter((code) => NETWORK_CODES.has(code))
    .slice(0, MAX_NETWORK_DIAGNOSTICS);
  return safe.length ? `${NETWORK_ERRORS}: ${safe.join(", ")}` : NETWORK_ERRORS;
}

export function filterSmokeDiagnostics(codes) {
  return Array.isArray(codes)
    ? [...new Set(codes.filter((code) => REPORTABLE_CODES.has(code)))]
    : [];
}

export function stagingSetupFailure(step, error, retained = false) {
  const prefix = retained
    ? "STAGING_SETUP_FAILED_OWNERSHIP_RECORD_RETAINED"
    : "STAGING_SETUP_FAILED";
  const codes = [
    ...(STEPS.includes(step) ? [`STAGING_SETUP_${step}_FAILED`] : []),
    ...(HTTP_STATUSES.includes(error?.status)
      ? [`STAGING_PROVIDER_HTTP_${error.status}`]
      : []),
    ...(FIXED_CODES.includes(error?.message) ? [error.message] : []),
    ...(Array.isArray(error?.errors)
      ? error.errors
          .map((entry) => CLERK_CODES.get(entry?.code))
          .filter((code) => code !== undefined)
      : []),
  ];
  return codes.length ? `${prefix}: ${codes.join(", ")}` : prefix;
}

export function smokeFailureDiagnostics(message) {
  if (typeof message !== "string") return [];
  // Playwright serializes native Error messages with their fixed name prefix.
  if (message.startsWith("Error: ")) message = message.slice(7);
  if (SAFE_CODES.has(message)) return [message];
  // All or nothing: one unknown, duplicate or extra entry rejects the message.
  const networkPrefix = `${NETWORK_ERRORS}: `;
  if (message.startsWith(networkPrefix)) {
    const codes = message.slice(networkPrefix.length).split(", ");
    return codes.length <= MAX_NETWORK_DIAGNOSTICS &&
      new Set(codes).size === codes.length &&
      codes.every((code) => NETWORK_CODES.has(code))
      ? [NETWORK_ERRORS, ...codes]
      : [];
  }
  const inputPrefix = "STAGING_INPUTS_INVALID: ";
  if (message.startsWith(inputPrefix)) {
    const fields = message.slice(inputPrefix.length).split(", ");
    return fields.every((field) => INPUTS.has(field))
      ? [...new Set(fields.map((field) => INPUTS.get(field)))]
      : [];
  }
  for (const prefix of [
    "STAGING_SETUP_FAILED",
    "STAGING_SETUP_FAILED_OWNERSHIP_RECORD_RETAINED",
  ]) {
    if (!message.startsWith(`${prefix}: `)) continue;
    const codes = message.slice(prefix.length + 2).split(", ");
    return codes.every((code) => SAFE_CODES.has(code))
      ? filterSmokeDiagnostics([
          ...codes,
          ...(prefix.endsWith("OWNERSHIP_RECORD_RETAINED") ? [prefix] : []),
        ])
      : [];
  }
  return [];
}
