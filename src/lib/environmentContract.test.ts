import { describe, expect, it } from "vitest";

import {
  CONTRACTED_VARIABLES,
  crossClassFindings,
  ENVIRONMENT_CLASSES,
  isEnvironmentClass,
  validateEnvironment,
  VARIABLE_CONTRACTS,
} from "./environmentContract";

/** A complete, well-formed deployed environment, per class. */
const deployed = (suffix: string): Record<string, string> => ({
  NEXT_PUBLIC_CONVEX_URL: `https://${suffix}.convex.cloud`,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_${suffix}`,
  CLERK_SECRET_KEY: `sk_${suffix}`,
  CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${suffix}`,
  CLERK_JWT_ISSUER_DOMAIN: `https://${suffix}.clerk.accounts.dev`,
  NEXT_PUBLIC_APP_URL: `https://${suffix}.example.com`,
  CONVEX_DEPLOY_KEY: `dk_${suffix}`,
  UPLOADTHING_TOKEN: `ut_${suffix}`,
  NEXT_PUBLIC_OBSERVABILITY_SINK: "console",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/th/sign-in",
});

const errorsOf = (report: ReturnType<typeof validateEnvironment>) =>
  report.findings.filter((finding) => finding.severity === "error");

describe("environment classes", () => {
  it("names exactly the four ADR-0012 §2 classes", () => {
    expect([...ENVIRONMENT_CLASSES]).toEqual([
      "developer",
      "preview",
      "staging",
      "production",
    ]);
  });

  it("recognizes only those four", () => {
    expect(isEnvironmentClass("staging")).toBe(true);
    expect(isEnvironmentClass("prod")).toBe(false);
    expect(isEnvironmentClass(undefined)).toBe(false);
  });
});

describe("validateEnvironment", () => {
  it("passes a complete production environment", () => {
    const report = validateEnvironment("production", deployed("prod"));
    expect(report.ok).toBe(true);
    expect(errorsOf(report)).toEqual([]);
  });

  it("fails production for each missing required variable, naming it", () => {
    const report = validateEnvironment("production", {});
    const missing = errorsOf(report).map((finding) => finding.variable);

    expect(missing).toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(missing).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(missing).toContain("CLERK_SECRET_KEY");
    expect(missing).toContain("CLERK_WEBHOOK_SIGNING_SECRET");
  });

  it("treats whitespace as absent", () => {
    const report = validateEnvironment("production", {
      ...deployed("prod"),
      CLERK_SECRET_KEY: "   ",
    });
    expect(errorsOf(report).map((finding) => finding.variable)).toEqual([
      "CLERK_SECRET_KEY",
    ]);
  });

  it("refuses a developer deployment name in a deployed environment", () => {
    // `CONVEX_DEPLOYMENT` is written by `convex dev`. In a build it means a
    // laptop's deployment leaked into a deployed artifact.
    const report = validateEnvironment("production", {
      ...deployed("prod"),
      CONVEX_DEPLOYMENT: "local:someones-laptop",
    });
    expect(errorsOf(report).map((finding) => finding.variable)).toContain(
      "CONVEX_DEPLOYMENT",
    );
  });

  it("refuses a deploy key on a developer machine", () => {
    const report = validateEnvironment("developer", {
      CONVEX_DEPLOY_KEY: "dk_production",
    });
    expect(
      errorsOf(report).map((finding) => [finding.variable, finding.rule]),
    ).toContainEqual(["CONVEX_DEPLOY_KEY", "FORBIDDEN_PRESENT"]);
  });

  it("lets a developer machine be empty, with warnings only", () => {
    const report = validateEnvironment("developer", {});
    expect(report.ok).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(
      report.findings.every((finding) => finding.severity === "warning"),
    ).toBe(true);
  });

  it("never reports a value, only a variable name", () => {
    const secret = "sk_this_must_never_appear";
    const report = validateEnvironment("developer", {
      CONVEX_DEPLOY_KEY: secret,
    });
    const serialized = JSON.stringify(report);

    expect(serialized).toContain("CONVEX_DEPLOY_KEY");
    expect(serialized).not.toContain(secret);
  });

  it("is deterministic, so two reports can be diffed", () => {
    const first = validateEnvironment("staging", {});
    const second = validateEnvironment("staging", {});
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("crossClassFindings", () => {
  it("finds a shared Convex deployment between two classes", () => {
    // The incident this exists for: a preview build pointed at production.
    const shared = "https://same.convex.cloud";
    const findings = crossClassFindings(
      {
        environmentClass: "preview",
        environment: { NEXT_PUBLIC_CONVEX_URL: shared },
      },
      {
        environmentClass: "production",
        environment: { NEXT_PUBLIC_CONVEX_URL: shared },
      },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("SHARED_WITH_ANOTHER_CLASS");
    expect(findings[0]?.variable).toBe("NEXT_PUBLIC_CONVEX_URL");
  });

  it("says nothing when the classes have distinct instances", () => {
    expect(
      crossClassFindings(
        { environmentClass: "staging", environment: deployed("staging") },
        { environmentClass: "production", environment: deployed("prod") },
      ),
    ).toEqual([]);
  });

  it("says nothing about a class compared with itself", () => {
    expect(
      crossClassFindings(
        { environmentClass: "production", environment: deployed("prod") },
        { environmentClass: "production", environment: deployed("prod") },
      ),
    ).toEqual([]);
  });

  it("never reports the shared value itself", () => {
    const shared = "https://secret.convex.cloud";
    const findings = crossClassFindings(
      {
        environmentClass: "preview",
        environment: { CLERK_SECRET_KEY: shared },
      },
      {
        environmentClass: "production",
        environment: { CLERK_SECRET_KEY: shared },
      },
    );
    expect(JSON.stringify(findings)).not.toContain(shared);
  });
});

describe("the contract table itself", () => {
  it("names each variable once", () => {
    expect(new Set(CONTRACTED_VARIABLES).size).toBe(
      CONTRACTED_VARIABLES.length,
    );
  });

  it("never marks a class both required and forbidden for one variable", () => {
    for (const contract of VARIABLE_CONTRACTS) {
      const overlap = contract.required.filter((environmentClass) =>
        contract.forbidden.includes(environmentClass),
      );
      expect(overlap, contract.variable).toEqual([]);
    }
  });

  it("gives every variable a rationale, so a failure explains itself", () => {
    for (const contract of VARIABLE_CONTRACTS) {
      expect(contract.rationale.length, contract.variable).toBeGreaterThan(20);
    }
  });

  it("keeps every secret out of the browser-inlined namespace", () => {
    // A `NEXT_PUBLIC_` prefix means "inlined into the bundle". Nothing whose
    // rationale describes it as secret may carry that prefix.
    for (const contract of VARIABLE_CONTRACTS) {
      if (!contract.rationale.toLowerCase().includes("secret")) continue;
      expect(
        contract.variable.startsWith("NEXT_PUBLIC_"),
        contract.variable,
      ).toBe(false);
    }
  });
});
