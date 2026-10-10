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

export function filterSmokeDiagnostics(codes) {
  return Array.isArray(codes)
    ? [...new Set(codes.filter((code) => SAFE_CODES.has(code)))]
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
