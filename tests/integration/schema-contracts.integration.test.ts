import { describe, expect, it } from "vitest";

import {
  CAPABILITY_FLAGS,
  DEFAULT_ORGANIZATION_SETTINGS,
  enabledCapabilityFlags,
  DEFAULT_TIMEZONE,
} from "../../convex/lib/organizationDefaults";
import {
  BOUNDED_LOOKUP_CONTRACTS,
  THIRD_NORMAL_FORM_CONTRACTS,
  UNIQUENESS_CONTRACTS,
  cardinalityContradictions,
  closedValueSet,
  describeSchema,
  lookupContractViolations,
  thirdNormalFormViolations,
  uniquenessContractViolations,
} from "../../convex/lib/schemaPolicy";
import schema from "../../convex/schema";

const facts = describeSchema(schema);
const tables = schema.tables;

describe("uniqueness and bounded-lookup contracts", () => {
  it("honours every declared contract with an exact index", () => {
    expect(uniquenessContractViolations(facts)).toEqual([]);
  });

  it("honours every bounded-lookup contract with an index that prefixes its key", () => {
    expect(lookupContractViolations(facts)).toEqual([]);
  });

  it("never declares one key both unique and many-per-key", () => {
    expect(cardinalityContradictions()).toEqual([]);
  });

  it("scopes every tenant contract to one organization", () => {
    const tenantContracts = UNIQUENESS_CONTRACTS.filter(
      (contract) =>
        !["organizations", "users", "permissions"].includes(contract.table),
    );
    const unscoped = tenantContracts.filter(
      (contract) => contract.key[0] !== "orgId",
    );
    expect(unscoped).toEqual([]);
    expect(
      BOUNDED_LOOKUP_CONTRACTS.filter(
        (contract) => contract.key[0] !== "orgId",
      ),
    ).toEqual([]);
  });

  it("states a condition on every contract rather than defaulting one", () => {
    const undeclared = UNIQUENESS_CONTRACTS.filter(
      (contract) =>
        contract.condition.kind !== "always" &&
        contract.condition.kind !== "whenPresent",
    );
    expect(undeclared).toEqual([]);
  });

  it("covers every external identity reference the mirror depends on", () => {
    const covered = UNIQUENESS_CONTRACTS.map(
      (contract) => `${contract.table}.${contract.key.join("+")}`,
    );
    expect(covered).toContain("organizations.clerkOrganizationId");
    expect(covered).toContain("users.clerkUserId");
    expect(covered).toContain("memberships.orgId+clerkMembershipId");
    expect(covered).toContain("permissions.code");
  });

  it("makes an idempotency replay check a single bounded lookup", () => {
    const contract = UNIQUENESS_CONTRACTS.find(
      (candidate) => candidate.table === "idempotencyRecords",
    );
    expect(contract?.key).toEqual(["orgId", "operation", "requestId"]);
  });
});

describe("third-normal-form operational relationships", () => {
  it("keeps every declared transitive dependency out of its dependent row", () => {
    expect(thirdNormalFormViolations(facts)).toEqual([]);
    expect(THIRD_NORMAL_FORM_CONTRACTS).toHaveLength(3);
  });

  it("resolves design request details from the authoritative order line", () => {
    const fields = Object.keys(tables.designRequests.validator.fields);
    expect(fields).toContain("customerOrderLineId");
    expect(fields).not.toEqual(
      expect.arrayContaining([
        "customerId",
        "customerProductCode",
        "designKey",
        "specification",
      ]),
    );
  });

  it("stores packet files as rows instead of an embedded repeating group", () => {
    const packetFields = Object.keys(tables.factoryPackets.validator.fields);
    expect(packetFields).not.toEqual(
      expect.arrayContaining([
        "customerId",
        "customerOrderNumber",
        "customerReference",
        "revisionNumber",
        "specification",
        "approvedFileIds",
        "releaseEvidence",
        "quantity",
      ]),
    );
    expect(Object.keys(tables.factoryPacketFiles.validator.fields)).toEqual([
      "orgId",
      "factoryPacketId",
      "masterCardFileId",
    ]);
  });
});

describe("conditional uniqueness of an optional key field", () => {
  const contract = UNIQUENESS_CONTRACTS.find(
    (candidate) => candidate.table === "devices",
  );

  it("marks devices.installationId unique only when present", () => {
    expect(contract?.key).toEqual(["orgId", "installationId"]);
    expect(contract?.condition).toEqual({
      kind: "whenPresent",
      fields: ["installationId"],
    });
  });

  it("keeps installationId optional, so an absent value is not a collision", () => {
    expect(tables.devices.validator.fields.installationId.isOptional).toBe(
      "optional",
    );
  });

  it("leaves no optional key field claimed unique unconditionally", () => {
    const unconditionalOverOptional = UNIQUENESS_CONTRACTS.filter(
      (candidate) => candidate.condition.kind === "always",
    ).flatMap((candidate) => {
      const table = facts.find((entry) => entry.name === candidate.table);
      return candidate.key
        .filter((field) => table?.optionalFieldNames.includes(field))
        .map((field) => `${candidate.table}.${field}`);
    });
    expect(unconditionalOverOptional).toEqual([]);
  });
});

describe("a support ticket may earn more than one grant", () => {
  it("declares no uniqueness contract over the ticket reference", () => {
    const uniqueOverTicket = UNIQUENESS_CONTRACTS.filter(
      (contract) =>
        contract.table === "supportGrants" &&
        contract.key.includes("ticketRef"),
    );
    expect(uniqueOverTicket).toEqual([]);
  });

  it("declares the ticket reference a many-per-key bounded lookup instead", () => {
    const contract = BOUNDED_LOOKUP_CONTRACTS.find(
      (candidate) =>
        candidate.table === "supportGrants" &&
        candidate.key.includes("ticketRef"),
    );
    expect(contract?.key).toEqual(["orgId", "ticketRef"]);
  });

  it("keeps the org-first index so ticket history stays bounded", () => {
    const supportGrants = facts.find((entry) => entry.name === "supportGrants");
    const index = supportGrants?.indexes.find(
      (candidate) => candidate.name === "by_orgId_ticketRef",
    );
    expect(index?.fields).toEqual(["orgId", "ticketRef"]);
  });

  it("still requires a ticket reference on every grant", () => {
    expect(tables.supportGrants.validator.fields.ticketRef.isOptional).toBe(
      "required",
    );
  });
});

describe("idempotency replay shape", () => {
  const fields = tables.idempotencyRecords.validator.fields;

  it("hashes the request, and does so from the moment the record exists", () => {
    expect(Object.keys(fields)).toContain("requestHash");
    expect(fields.requestHash.isOptional).toBe("required");
  });

  it("keeps the response hash separate and optional until the operation completes", () => {
    expect(fields.resultHash.isOptional).toBe("optional");
    expect(fields.resultRef.isOptional).toBe("optional");
    expect(fields.requestHash).not.toBe(fields.resultHash);
  });

  it("can decide retry versus reused request ID from the key plus the request hash", () => {
    const contract = UNIQUENESS_CONTRACTS.find(
      (candidate) => candidate.table === "idempotencyRecords",
    );
    expect(contract?.key).toEqual(["orgId", "operation", "requestId"]);
    expect(contract?.condition.kind).toBe("always");
    for (const required of ["operation", "requestId", "requestHash"]) {
      expect(
        (fields as Record<string, { isOptional: string }>)[required]
          ?.isOptional,
      ).toBe("required");
    }
  });

  it("stores no request or response payload, only references and digests", () => {
    const names = Object.keys(fields);
    for (const forbidden of [
      "args",
      "arguments",
      "requestBody",
      "responseBody",
      "payload",
      "input",
      "output",
      "response",
      "result",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    expect(names).toEqual(
      expect.arrayContaining(["requestHash", "resultRef", "resultHash"]),
    );
  });
});

describe("closed value sets", () => {
  it("closes the organization status set", () => {
    expect(
      closedValueSet(tables.organizations.validator.fields.status),
    ).toEqual(["ACTIVE", "SUSPENDED", "CLOSED"]);
  });

  it("closes locale and currency", () => {
    const settings = tables.organizations.validator.fields.settings;
    expect(closedValueSet(settings.fields.locale)).toEqual(["th", "en"]);
    expect(closedValueSet(settings.fields.currency)).toEqual(["THB"]);
  });

  it("closes the membership scope mode so an empty warehouse set cannot mean all", () => {
    expect(
      closedValueSet(tables.memberships.validator.fields.scopeMode),
    ).toEqual(["ORG_WIDE", "WAREHOUSE_SCOPED"]);
  });

  it("closes the support access mode", () => {
    expect(
      closedValueSet(tables.supportGrants.validator.fields.accessMode),
    ).toEqual(["READ_ONLY", "READ_WRITE"]);
  });

  it("closes the device type", () => {
    expect(closedValueSet(tables.devices.validator.fields.deviceType)).toEqual([
      "HANDHELD",
      "WORKSTATION",
      "TABLET",
    ]);
  });

  it("closes every remaining status field the policy branches on", () => {
    expect(closedValueSet(tables.users.validator.fields.status)).toEqual([
      "ACTIVE",
      "DEACTIVATED",
    ]);
    expect(closedValueSet(tables.memberships.validator.fields.status)).toEqual([
      "ACTIVE",
      "SUSPENDED",
      "REVOKED",
    ]);
    expect(closedValueSet(tables.warehouses.validator.fields.status)).toEqual([
      "ACTIVE",
      "INACTIVE",
    ]);
    expect(closedValueSet(tables.roles.validator.fields.status)).toEqual([
      "ACTIVE",
      "ARCHIVED",
    ]);
    expect(closedValueSet(tables.devices.validator.fields.status)).toEqual([
      "ACTIVE",
      "RETIRED",
    ]);
    expect(
      closedValueSet(tables.idempotencyRecords.validator.fields.status),
    ).toEqual(["IN_PROGRESS", "SUCCEEDED", "FAILED"]);
    expect(
      closedValueSet(tables.supportGrants.validator.fields.status),
    ).toEqual([
      "REQUESTED",
      "APPROVED",
      "ACTIVE",
      "REJECTED",
      "EXPIRED",
      "REVOKED",
    ]);
    expect(closedValueSet(tables.permissions.validator.fields.scope)).toEqual([
      "ORG",
      "WAREHOUSE",
      "PLATFORM",
    ]);
  });

  it("closes the audit outcome and denial reason vocabulary", () => {
    expect(closedValueSet(tables.auditEvents.validator.fields.outcome)).toEqual(
      ["ALLOWED", "DENIED"],
    );
    expect(
      closedValueSet(tables.auditEvents.validator.fields.actorKind),
    ).toEqual(["USER", "SYSTEM", "PLATFORM_SUPPORT"]);
    expect(
      closedValueSet(tables.auditEvents.validator.fields.denialReason),
    ).toEqual([
      "NO_PERMISSION",
      "OUT_OF_WAREHOUSE_SCOPE",
      "THRESHOLD_EXCEEDED",
      "APPROVAL_REQUIRED",
      "REVERIFICATION_REQUIRED",
      "ENTITLEMENT_DISABLED",
      "INACTIVE_MEMBERSHIP",
    ]);
  });
});

describe("organization defaults", () => {
  it("defaults to Asia/Bangkok, Thai, and THB", () => {
    expect(DEFAULT_ORGANIZATION_SETTINGS.timezone).toBe("Asia/Bangkok");
    expect(DEFAULT_TIMEZONE).toBe("Asia/Bangkok");
    expect(DEFAULT_ORGANIZATION_SETTINGS.locale).toBe("th");
    expect(DEFAULT_ORGANIZATION_SETTINGS.currency).toBe("THB");
  });

  it("enables no capability by default", () => {
    expect(enabledCapabilityFlags(DEFAULT_ORGANIZATION_SETTINGS)).toEqual([]);
  });

  it("keeps serial, mixed content, consignment, negative stock, and support grants off", () => {
    expect(DEFAULT_ORGANIZATION_SETTINGS.serialTrackingEnabled).toBe(false);
    expect(DEFAULT_ORGANIZATION_SETTINGS.mixedContentEnabled).toBe(false);
    expect(DEFAULT_ORGANIZATION_SETTINGS.consignedStockEnabled).toBe(false);
    expect(DEFAULT_ORGANIZATION_SETTINGS.negativeAvailableAllowed).toBe(false);
    expect(DEFAULT_ORGANIZATION_SETTINGS.supportGrantsEnabled).toBe(false);
  });

  it("declares every capability flag that exists in the settings validator", () => {
    const booleanFields = Object.entries(
      tables.organizations.validator.fields.settings.fields,
    )
      .filter(([, validator]) => validator.kind === "boolean")
      .map(([name]) => name);
    expect(booleanFields.sort()).toEqual([...CAPABILITY_FLAGS].sort());
  });

  it("cannot be mutated by a caller", () => {
    expect(Object.isFrozen(DEFAULT_ORGANIZATION_SETTINGS)).toBe(true);
  });
});

describe("support grants ship disabled and offer no bypass", () => {
  const fields = Object.keys(tables.supportGrants.validator.fields);

  it("requires a reason, a ticket, a requester, and an expiry", () => {
    const mustBeRequired = new Set([
      "reason",
      "ticketRef",
      "requestedBy",
      "expiresAt",
    ]);
    for (const required of mustBeRequired) {
      expect(fields).toContain(required);
    }
    const wronglyOptional = Object.entries(
      tables.supportGrants.validator.fields,
    )
      .filter(
        ([name, validator]) =>
          mustBeRequired.has(name) && validator.isOptional !== "required",
      )
      .map(([name]) => name);
    expect(wronglyOptional).toEqual([]);
  });

  it("keeps the three approvals in distinct fields so 'distinct actor' is checkable", () => {
    expect(fields).toContain("firstApprovalBy");
    expect(fields).toContain("secondApprovalBy");
    expect(fields).toContain("tenantApprovalByUserId");
    expect(
      new Set(["firstApprovalBy", "secondApprovalBy", "tenantApprovalByUserId"])
        .size,
    ).toBe(3);
  });

  it("is gated by an organization policy flag that defaults to false", () => {
    const settings = tables.organizations.validator.fields.settings;
    expect(Object.keys(settings.fields)).toContain("supportGrantsEnabled");
    expect(DEFAULT_ORGANIZATION_SETTINGS.supportGrantsEnabled).toBe(false);
  });

  it("has no field that could express a standing or unapproved grant", () => {
    const bypassWords = [
      "permanent",
      "indefinite",
      "bypass",
      "skip",
      "override",
      "impersonate",
      "alltenants",
      "godmode",
      "unrestricted",
    ];
    const offending = fields.filter((field) =>
      bypassWords.some((word) => field.toLowerCase().includes(word)),
    );
    expect(offending).toEqual([]);
  });
});

describe("request, actor, and device context", () => {
  it("records who, which request, and which device on an audit event", () => {
    const fields = Object.keys(tables.auditEvents.validator.fields);
    expect(fields).toEqual(
      expect.arrayContaining([
        "actorKind",
        "actorUserId",
        "requestId",
        "deviceId",
        "supportGrantId",
        "outcome",
      ]),
    );
    expect(tables.auditEvents.validator.fields.requestId.isOptional).toBe(
      "required",
    );
  });

  it("records actor and device context on an idempotency record", () => {
    const fields = Object.keys(tables.idempotencyRecords.validator.fields);
    expect(fields).toEqual(
      expect.arrayContaining([
        "operation",
        "requestId",
        "actorUserId",
        "deviceId",
      ]),
    );
  });

  it("records the actor, device, and step-up freshness on a session event", () => {
    const fields = Object.keys(tables.sessionsAudit.validator.fields);
    expect(fields).toEqual(
      expect.arrayContaining([
        "userId",
        "eventType",
        "deviceId",
        "reverifiedAt",
      ]),
    );
  });

  it("keeps devices free of any secret used to authenticate them", () => {
    const fields = Object.keys(tables.devices.validator.fields);
    expect(fields).toEqual(
      expect.arrayContaining([
        "label",
        "deviceType",
        "status",
        "installationId",
      ]),
    );
    expect(fields).not.toContain("pairingKey");
    expect(fields).not.toContain("registrationSecret");
  });
});
