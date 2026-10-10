/**
 * Integration tier — the construction helpers that make tenancy structural.
 *
 * `tenantFields` and `byOrg` are the only sanctioned way to declare a tenant table
 * and a tenant index. Their whole value is that they cannot be talked out of the
 * discriminator, so the interesting tests are the attempts to talk them out of it:
 *
 * - a caller-supplied `orgId` is a compile error (the `@ts-expect-error` lines
 *   below fail the build if the type ever stops rejecting them) *and* a runtime
 *   throw, so a cast, a JavaScript caller, or a spread the compiler cannot see
 *   fails loudly instead of silently replacing the discriminator;
 * - `orgId` comes out first, because `schemaPolicy` and every generated type read
 *   declaration order;
 * - `byOrg` always prepends the discriminator and never accepts it twice.
 *
 * These are shape guarantees about declarations. No document is read or written
 * here: there is no accessor, no auth, and no runtime isolation yet.
 */
import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  TENANT_DISCRIMINATOR,
  byOrg,
  orgIdField,
  tenantFields,
} from "../../convex/lib/tenantTable";

/** The parameter type as callers see it, used to stage deliberate bypasses. */
type FieldSpec = Parameters<typeof tenantFields>[0];

describe("tenantFields supplies the tenant discriminator", () => {
  it("puts orgId first, before the caller's own fields", () => {
    const fields = tenantFields({ code: v.string(), status: v.boolean() });
    expect(Object.keys(fields)).toEqual(["orgId", "code", "status"]);
  });

  it("uses the module's organizations id validator, not a look-alike", () => {
    const fields = tenantFields({ code: v.string() });
    expect(fields.orgId).toBe(orgIdField);
    expect(fields.orgId.kind).toBe("id");
    expect(fields.orgId.tableName).toBe("organizations");
    expect(fields.orgId.isOptional).toBe("required");
  });

  it("keeps the caller's validators by identity", () => {
    const code = v.string();
    const fields = tenantFields({ code });
    expect(fields.code).toBe(code);
  });

  it("returns a new object and does not mutate the caller's", () => {
    const input = { code: v.string() };
    const fields = tenantFields(input);
    expect(fields).not.toBe(input);
    expect(Object.keys(input)).toEqual(["code"]);
  });

  it("accepts a table whose only content is the discriminator", () => {
    expect(Object.keys(tenantFields({}))).toEqual(["orgId"]);
  });

  it("names the discriminator once, from one constant", () => {
    expect(TENANT_DISCRIMINATOR).toBe("orgId");
    expect(Object.keys(tenantFields({}))).toEqual([TENANT_DISCRIMINATOR]);
  });
});

describe("tenantFields refuses a caller-provided orgId", () => {
  it("is a type error to pass orgId at all", () => {
    const wrongValidator = () => {
      // @ts-expect-error orgId is supplied by the helper, never by the caller.
      return tenantFields({ orgId: v.string() });
    };
    const rightValidator = () => {
      // @ts-expect-error the caller does not choose the discriminator either.
      return tenantFields({ orgId: v.id("organizations") });
    };
    const optionalDiscriminator = () => {
      // @ts-expect-error an optional discriminator is rejected for the same reason.
      return tenantFields({ orgId: v.optional(v.id("organizations")) });
    };

    expect(wrongValidator).toThrow(/received its own "orgId" field/);
    expect(rightValidator).toThrow(/never taken from a caller/);
    expect(optionalDiscriminator).toThrow(/INV-0001-02/);
  });

  it("throws rather than overriding when the type check is bypassed by a cast", () => {
    const smuggled = {
      orgId: v.string(),
      code: v.string(),
    } as unknown as FieldSpec;
    expect(() => tenantFields(smuggled)).toThrow(
      /tenantFields\(\) received its own "orgId" field/,
    );
  });

  it("throws when orgId arrives last, where a spread would have won", () => {
    const smuggled = {
      code: v.string(),
      orgId: v.id("organizations"),
    } as unknown as FieldSpec;
    expect(() => tenantFields(smuggled)).toThrow(/never taken from a caller/);
  });

  it("throws when orgId arrives through a spread the compiler cannot see", () => {
    const injected: Record<string, ReturnType<typeof v.string>> = {
      orgId: v.string(),
    };
    const smuggled = { code: v.string(), ...injected } as unknown as FieldSpec;
    expect(() => tenantFields(smuggled)).toThrow(/never taken from a caller/);
  });

  it("never yields a document whose orgId came from the caller", () => {
    const impostor = v.string();
    const smuggled = { orgId: impostor } as unknown as FieldSpec;
    let produced: Record<string, unknown> | undefined;
    try {
      produced = tenantFields(smuggled);
    } catch {
      produced = undefined;
    }
    expect(produced).toBeUndefined();
  });
});

describe("byOrg prefixes every index with the discriminator", () => {
  it("prepends orgId to the given fields, in order", () => {
    expect(byOrg("status", "code")).toEqual(["orgId", "status", "code"]);
  });

  it("produces a single-field index for a table keyed only by tenant", () => {
    expect(byOrg()).toEqual(["orgId"]);
  });

  it("returns a new array each time, so no caller shares index state", () => {
    expect(byOrg("code")).not.toBe(byOrg("code"));
  });

  it("throws when asked to repeat the discriminator", () => {
    const smuggled = byOrg as (...fields: string[]) => string[];
    expect(() => smuggled("orgId")).toThrow(
      /received "orgId" as an index field/,
    );
    expect(() => smuggled("status", "orgId")).toThrow(/must not be repeated/);
  });
});
