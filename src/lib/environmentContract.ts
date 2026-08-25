export const ENVIRONMENT_CLASSES = [
  "developer",
  "preview",
  "staging",
  "production",
] as const;

export type EnvironmentClass = (typeof ENVIRONMENT_CLASSES)[number];

export const isEnvironmentClass = (value: unknown): value is EnvironmentClass =>
  typeof value === "string" &&
  (ENVIRONMENT_CLASSES as readonly string[]).includes(value);

export type FindingSeverity = "error" | "warning";

export interface EnvironmentFinding {
  readonly severity: FindingSeverity;

  readonly variable: string;
  readonly rule:
    | "REQUIRED_MISSING"
    | "FORBIDDEN_PRESENT"
    | "RECOMMENDED_MISSING"
    | "SHARED_WITH_ANOTHER_CLASS";
  readonly detail: string;
}

export interface EnvironmentReport {
  readonly environmentClass: EnvironmentClass;
  readonly findings: readonly EnvironmentFinding[];

  readonly ok: boolean;
}

interface VariableContract {
  readonly variable: string;
  readonly required: readonly EnvironmentClass[];
  readonly forbidden: readonly EnvironmentClass[];
  readonly recommended: readonly EnvironmentClass[];

  readonly rationale: string;
}

const ALL: readonly EnvironmentClass[] = ENVIRONMENT_CLASSES;
const NONE: readonly EnvironmentClass[] = [];
const DEPLOYED: readonly EnvironmentClass[] = [
  "preview",
  "staging",
  "production",
];

export const VARIABLE_CONTRACTS: readonly VariableContract[] = Object.freeze([
  {
    variable: "NEXT_PUBLIC_CONVEX_URL",
    required: DEPLOYED,
    forbidden: NONE,
    recommended: ["developer"],
    rationale:
      "The browser cannot reach a deployment without it; a deployed environment that lacks it serves setup gates to real users.",
  },
  {
    variable: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    required: DEPLOYED,
    forbidden: NONE,
    recommended: ["developer"],
    rationale:
      "Without an identity provider every tenant-bound function denies, so a deployed environment has no usable screen (ADR-0001 §2).",
  },
  {
    variable: "CLERK_SECRET_KEY",
    required: DEPLOYED,
    forbidden: NONE,
    recommended: NONE,
    rationale: "Server-side Clerk API access; secret, never NEXT_PUBLIC_.",
  },
  {
    variable: "CLERK_WEBHOOK_SIGNING_SECRET",
    required: DEPLOYED,
    forbidden: NONE,
    recommended: NONE,
    rationale:
      "The webhook verifies its signature before any state change (INV-0001-04); an unset secret means the mirror cannot be fed at all.",
  },
  {
    variable: "CLERK_JWT_ISSUER_DOMAIN",
    required: DEPLOYED,
    forbidden: NONE,
    recommended: NONE,
    rationale:
      "Convex validates Clerk-issued tokens against this issuer; it is also a Convex environment variable, not only a Next.js one.",
  },
  {
    variable: "NEXT_PUBLIC_CONVEX_SITE_URL",
    required: DEPLOYED,
    forbidden: NONE,
    recommended: ["developer"],
    rationale:
      "The trusted UploadThing completion callback cannot register verified private files without the Convex HTTP-actions origin.",
  },
  {
    variable: "CONVEX_DEPLOYMENT",
    required: NONE,
    forbidden: ["preview", "staging", "production"],
    recommended: ["developer"],
    rationale:
      "Written by `convex dev` for a developer machine. In a deployed environment it is a developer's deployment name leaking into a build.",
  },
  {
    variable: "CONVEX_DEPLOY_KEY",
    required: NONE,
    forbidden: ["developer"],
    recommended: DEPLOYED,
    rationale:
      "A deploy credential belongs to CI, not to a laptop; it grants write access to a deployment.",
  },
  {
    variable: "UPLOADTHING_TOKEN",
    required: DEPLOYED,
    forbidden: NONE,
    recommended: ["developer"],
    rationale:
      "This secret signs trusted completion receipts and authorizes private UploadThing operations; every deployed class needs its own app (D-20).",
  },
  {
    variable: "NEXT_PUBLIC_APP_URL",
    required: DEPLOYED,
    forbidden: NONE,
    recommended: NONE,
    rationale:
      "Webhook callbacks and absolute links need the deployment's own origin.",
  },
  {
    variable: "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
    required: NONE,
    forbidden: NONE,
    recommended: DEPLOYED,
    rationale:
      "Where Clerk sends an unauthenticated visitor; unset means Clerk's hosted default rather than this application's own route.",
  },
  {
    variable: "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
    required: NONE,
    forbidden: NONE,
    recommended: NONE,
    rationale:
      "Tenants are sales-provisioned (B-02), so self-service sign-up is normally absent by design.",
  },
  {
    variable: "NEXT_PUBLIC_OBSERVABILITY_SINK",
    required: NONE,
    forbidden: NONE,
    recommended: ALL,
    rationale:
      "Selects the ObservabilityPort adapter (INT-05). Unset means the no-op adapter, which is safe and silent — and silence in staging is a gap, not a feature.",
  },
]);

export const CLASS_SCOPED_VARIABLES: readonly string[] = Object.freeze([
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "UPLOADTHING_TOKEN",
  "NEXT_PUBLIC_APP_URL",
]);

const present = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

export function validateEnvironment(
  environmentClass: EnvironmentClass,
  environment: Readonly<Record<string, string | undefined>>,
): EnvironmentReport {
  const findings: EnvironmentFinding[] = [];

  for (const contract of VARIABLE_CONTRACTS) {
    const has = present(environment[contract.variable]);

    if (contract.required.includes(environmentClass) && !has) {
      findings.push({
        severity: "error",
        variable: contract.variable,
        rule: "REQUIRED_MISSING",
        detail: contract.rationale,
      });
      continue;
    }
    if (contract.forbidden.includes(environmentClass) && has) {
      findings.push({
        severity: "error",
        variable: contract.variable,
        rule: "FORBIDDEN_PRESENT",
        detail: contract.rationale,
      });
      continue;
    }
    if (contract.recommended.includes(environmentClass) && !has) {
      findings.push({
        severity: "warning",
        variable: contract.variable,
        rule: "RECOMMENDED_MISSING",
        detail: contract.rationale,
      });
    }
  }

  findings.sort(compareFindings);

  return Object.freeze({
    environmentClass,
    findings: Object.freeze(findings),
    ok: !findings.some((finding) => finding.severity === "error"),
  });
}

export function crossClassFindings(
  left: {
    readonly environmentClass: EnvironmentClass;
    readonly environment: Readonly<Record<string, string | undefined>>;
  },
  right: {
    readonly environmentClass: EnvironmentClass;
    readonly environment: Readonly<Record<string, string | undefined>>;
  },
): readonly EnvironmentFinding[] {
  if (left.environmentClass === right.environmentClass) return [];

  const findings: EnvironmentFinding[] = [];
  for (const variable of CLASS_SCOPED_VARIABLES) {
    const leftValue = left.environment[variable];
    const rightValue = right.environment[variable];
    if (!present(leftValue) || !present(rightValue)) continue;
    if (leftValue !== rightValue) continue;

    findings.push({
      severity: "error",
      variable,
      rule: "SHARED_WITH_ANOTHER_CLASS",
      detail: `${left.environmentClass} and ${right.environmentClass} resolve this variable to the same value; each class needs its own instance (ADR-0012 §2).`,
    });
  }
  return Object.freeze(findings.sort(compareFindings));
}

const SEVERITY_ORDER: Readonly<Record<FindingSeverity, number>> = {
  error: 0,
  warning: 1,
};

const compareFindings = (
  left: EnvironmentFinding,
  right: EnvironmentFinding,
): number =>
  SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
  left.variable.localeCompare(right.variable);

export const CONTRACTED_VARIABLES: readonly string[] = Object.freeze(
  VARIABLE_CONTRACTS.map((contract) => contract.variable),
);
