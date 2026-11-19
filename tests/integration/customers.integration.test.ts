import { type FunctionReturnType } from "convex/server";
import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { listCustomersPage } from "../../convex/customers/catalogue";
import { provisionHrForOrganization } from "../../convex/lib/authorizationSeedConvex";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../convex/lib/organizationDefaults";
import {
  AI_USAGE_PERMISSION_CODES,
  CUSTOMER_PERMISSION_CODES,
  HR_ADMIN_PERMISSION_CODES,
  PLANNER_PERMISSION_CODES,
} from "../../convex/lib/permissions";
import {
  isValidThaiTaxIdChecksum,
  normalizeCustomerName,
  normalizeTaxId,
  suggestNextCustomerCode,
  type CustomerEditableInput,
} from "../../convex/model/customers/customers";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";
import { measured, settlePage } from "../fixtures/query-read-stats";

const catalogue = api.customers.catalogue;
const writes = api.customers.writes;
const modules = {
  "../convex/aiUsage/provision.ts": () =>
    import("../../convex/aiUsage/provision"),
  "../convex/customers/catalogue.ts": () =>
    import("../../convex/customers/catalogue"),
  "../convex/customers/provision.ts": () =>
    import("../../convex/customers/provision"),
  "../convex/customers/writes.ts": () =>
    import("../../convex/customers/writes"),
  "../convex/workspace/current.ts": () =>
    import("../../convex/workspace/current"),
};

function allowed<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error("Expected an authorized customer call");
  return result.value;
}

async function setup(roleA = "ORG_ADMIN") {
  const world = await createConvexTenantWorld(modules);
  const roles = await seedConvexAuthorization(world, { roleA });
  const actorA = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const actorB = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_b",
  });
  const create = async (
    args: CustomerEditableInput & { requestId: string; code?: string },
  ) => {
    const result = allowed(await actorA.mutation(writes.createCustomer, args));
    if (!result.ok) throw new Error(`Customer creation failed: ${result.code}`);
    return result;
  };
  return { ...world, roles, actorA, actorB, create };
}

const searchArgs = {
  search: "needle",
  pageSize: 20,
  status: "ACTIVE",
} as const;
type ListOutcome = FunctionReturnType<typeof catalogue.listCustomersPage>;
type ListPage = Extract<ListOutcome, { ok: true }>["value"];

async function seedCustomerSearch(
  matches: (index: number) => boolean,
  notes?: string,
) {
  const world = await setup();
  const ids = await world.t.run(async (ctx) => {
    const ids = [];
    for (let index = 0; index < 100; index++) {
      const name = `Customer ${String(index).padStart(2, "0")}`;
      ids.push(
        await ctx.db.insert("customers", {
          orgId: world.orgA,
          code: `FIXTURE-${index}`,
          name,
          normalizedName: name.toLowerCase(),
          ...(matches(index) ? { legalNameEn: "needle" } : {}),
          ...(notes === undefined ? {} : { notes }),
          status: "ACTIVE",
          version: 1,
          createdAt: 0,
          updatedAt: 0,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        }),
      );
    }
    return ids;
  });
  return { ...world, ids };
}

describe("customer model", () => {
  it("normalizes search text and tax IDs independently of the stored display name", () => {
    expect(normalizeCustomerName("  กิ่ง   Ａcme ")).toBe("กิ่ง acme");
    expect(normalizeTaxId("0 1055-5301234 1")).toBe("0105553012341");
    expect(normalizeTaxId("๐105553012341")).toBeNull();
    expect(normalizeTaxId("010555301234")).toBeNull();
    for (const id of ["0105553012341", "0105537088214", "0107536004175"]) {
      expect(isValidThaiTaxIdChecksum(id)).toBe(true);
    }
    expect(isValidThaiTaxIdChecksum("0105553012342")).toBe(false);
    expect(suggestNextCustomerCode()).toBe("C-0001");
    expect(suggestNextCustomerCode(9999)).toBe("C-10000");
  });
});

describe("customer catalogue", () => {
  it("saves name-only records in the original script and leaves blank optionals unset", async () => {
    const { actorA, create } = await setup();
    const thaiName = "กิ่งไม้  จำกัด";
    const thai = await create({
      requestId: "thai",
      name: thaiName,
      code: " ",
      legalNameTh: "",
      legalNameEn: " ",
      taxId: " ",
      deliveryAddress: { postcode: " " },
      contact: {},
      notes: "\n",
    });
    const english = await create({
      requestId: "english",
      name: "English Only",
    });
    expect(thai.replayed).toBe(false);
    const thaiRow = allowed(
      await actorA.query(catalogue.getCustomer, {
        customerId: thai.customerId,
      }),
    );
    expect(thaiRow).toMatchObject({
      name: thaiName,
      code: "C-0001",
      normalizedName: "กิ่งไม้ จำกัด".normalize("NFKC"),
      customerId: thai.customerId,
      status: "ACTIVE",
      version: 1,
    });
    for (const field of [
      "legalNameTh",
      "legalNameEn",
      "taxId",
      "taxIdChecksumValid",
      "establishment",
      "contact",
      "deliveryAddress",
      "notes",
      "codeSequenceKey",
    ]) {
      expect(thaiRow).not.toHaveProperty(field);
    }
    const englishRow = allowed(
      await actorA.query(catalogue.getCustomer, {
        customerId: english.customerId,
      }),
    );
    expect(englishRow).toMatchObject({ name: "English Only", code: "C-0002" });
    expect(englishRow).not.toHaveProperty("legalNameTh");
  });

  it("preserves leading zeroes and saves a bad-checksum tax ID with a detail warning", async () => {
    const { actorA, create } = await setup();
    const { customerId } = await create({
      requestId: "tax",
      name: "Tax customer",
      taxId: "0-1055-53012-34-2",
      establishment: { kind: "HEAD_OFFICE" },
    });
    expect(
      allowed(await actorA.query(catalogue.getCustomer, { customerId })),
    ).toMatchObject({
      taxId: "0105553012342",
      taxIdChecksumValid: false,
      establishment: { kind: "HEAD_OFFICE" },
    });
  });

  it.each([
    [{ taxId: "0-100" }, "taxId"],
    [
      { establishment: { kind: "BRANCH", code: "00000" } },
      "establishment.code",
    ],
    [{ establishment: { kind: "BRANCH", code: "1234" } }, "establishment.code"],
    [{ contact: { email: "missing-at" } }, "contact.email"],
    [{ contact: { phone: "1".repeat(33) } }, "contact.phone"],
    [{ contact: { name: "n".repeat(201) } }, "contact.name"],
    [{ contact: { email: `@${"x".repeat(254)}` } }, "contact.email"],
    [
      { deliveryAddress: { postcode: "1".repeat(11) } },
      "deliveryAddress.postcode",
    ],
    [{ deliveryAddress: { line: "a".repeat(201) } }, "deliveryAddress.line"],
    [{ notes: "x".repeat(2001) }, "notes"],
    [{ legalNameEn: "x".repeat(201) }, "legalNameEn"],
    [{ name: "x".repeat(201) }, "name"],
    [{ name: "   " }, "name"],
    [{ code: "A B" }, "code"],
  ] satisfies [Partial<CustomerEditableInput> & { code?: string }, string][])(
    "rejects invalid input %j with the field %s",
    async (input, field) => {
      const { actorA } = await setup();
      expect(
        allowed(
          await actorA.mutation(writes.createCustomer, {
            requestId: "invalid",
            name: "Customer",
            ...input,
          }),
        ),
      ).toEqual({ ok: false, code: "FIELD_INVALID", field });
    },
  );

  it("allocates the next numeric code, reserves archived codes, and permits duplicate names", async () => {
    const { actorA, actorB, create } = await setup();
    expect(allowed(await actorA.query(catalogue.suggestCustomerCode, {}))).toBe(
      "C-0001",
    );
    const first = await create({ requestId: "first", name: "Same name" });
    const second = await create({ requestId: "second", name: "Same name" });
    expect(first.customerId).not.toBe(second.customerId);
    expect(allowed(await actorA.query(catalogue.suggestCustomerCode, {}))).toBe(
      "C-0003",
    );
    const manual = await create({
      requestId: "manual",
      name: "Other",
      code: " c-9999 ",
    });
    await actorA.mutation(writes.archiveCustomer, {
      requestId: "archive",
      customerId: manual.customerId,
      expectedVersion: 1,
    });
    expect(
      allowed(
        await actorA.mutation(writes.createCustomer, {
          requestId: "duplicate",
          name: "New",
          code: "C-9999",
        }),
      ),
    ).toEqual({ ok: false, code: "DUPLICATE_KEY", field: "code" });
    expect(allowed(await actorA.query(catalogue.suggestCustomerCode, {}))).toBe(
      "C-10000",
    );
    const generated = await create({ requestId: "generated", name: "New" });
    expect(
      allowed(
        await actorA.query(catalogue.getCustomer, {
          customerId: generated.customerId,
        }),
      ),
    ).toMatchObject({ code: "C-10000" });
    expect(allowed(await actorA.query(catalogue.suggestCustomerCode, {}))).toBe(
      "C-10001",
    );
    expect(allowed(await actorB.query(catalogue.suggestCustomerCode, {}))).toBe(
      "C-0001",
    );
    expect(
      allowed(
        await actorB.mutation(writes.createCustomer, {
          requestId: "first",
          name: "Other org",
          code: "C-9999",
        }),
      ),
    ).toMatchObject({ ok: true, replayed: false });
  });

  it("rejects a generated code when the next sequence number exceeds the explicit code limit", async () => {
    const { actorA, create } = await setup();
    const highest = `C-${"9".repeat(62)}`;
    const overflow = `C-1${"0".repeat(62)}`;
    const { customerId } = await create({
      requestId: "highest",
      code: highest,
      name: "Highest",
    });
    for (const code of [overflow, undefined]) {
      expect(
        allowed(
          await actorA.mutation(writes.createCustomer, {
            requestId: code ? "explicit-overflow" : "generated-overflow",
            name: "Overflow",
            ...(code ? { code } : {}),
          }),
        ),
      ).toEqual({ ok: false, code: "FIELD_INVALID", field: "code" });
    }
    expect(
      allowed(await actorA.query(catalogue.listCustomersPage, { pageSize: 20 }))
        .page,
    ).toEqual([
      { customerId, code: highest, name: "Highest", status: "ACTIVE" },
    ]);
  });

  it("returns null for malformed, deleted and foreign IDs and refuses foreign writes", async () => {
    const { actorA, actorB, create, t, warehouses } = await setup();
    const { customerId } = await create({
      requestId: "owned",
      name: "Tenant A customer",
    });
    const missing = await create({
      requestId: "deleted",
      name: "Deleted customer",
    });
    await t.run(async (ctx) => {
      const id = ctx.db.normalizeId("customers", missing.customerId);
      if (!id) throw new Error("Invalid customer ID");
      await ctx.db.delete("customers", id);
    });
    for (const id of ["", "invalid", warehouses.alphaA, missing.customerId]) {
      expect(
        allowed(await actorA.query(catalogue.getCustomer, { customerId: id })),
      ).toBeNull();
    }
    expect(
      allowed(await actorB.query(catalogue.getCustomer, { customerId })),
    ).toBeNull();
    const target = { customerId, requestId: "foreign", expectedVersion: 1 };
    expect(
      allowed(
        await actorB.mutation(writes.updateCustomer, {
          ...target,
          name: "Wrong tenant",
        }),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      allowed(await actorB.mutation(writes.archiveCustomer, target)),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      allowed(await actorB.mutation(writes.restoreCustomer, target)),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("authorizes customer-only managers and reports read-only access without warehouse grants", async () => {
    const world = await setup();
    const { t, orgA, roles, actorA, create } = world;
    const readerRole = "CUSTOMER_READER";
    await t.run(async (ctx) => {
      const roleId = roles.rolesA.get("ORG_ADMIN")!;
      const grants = await ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (q) =>
          q.eq("orgId", orgA).eq("roleId", roleId),
        )
        .collect();
      for (const grant of grants)
        if (!grant.permissionCode.startsWith("masterData.customer."))
          await ctx.db.delete("rolePermissions", grant._id);
      const readRoleId = await ctx.db.insert("roles", {
        orgId: orgA,
        key: readerRole,
        name: "Customer reader",
        seeded: false,
        status: "ACTIVE",
      });
      await ctx.db.insert("rolePermissions", {
        orgId: orgA,
        roleId: readRoleId,
        permissionCode: "masterData.customer.read",
      });
    });
    const { clerkUserId } = await seedSecondActorForOrgA(world, readerRole);
    const reader = t.withIdentity({
      subject: clerkUserId,
      org_id: "org_fixture_a",
    });
    expect(
      await actorA.query(api.workspace.current.readCurrent, {}),
    ).toMatchObject({
      ok: false,
      denial: { code: "AUTHORIZATION_DENIED" },
    });
    const { customerId } = await create({
      requestId: "customer-only",
      name: "Customer only",
    });
    for (const [actor, canManage] of [
      [actorA, true],
      [reader, false],
    ] as const) {
      expect(
        allowed(
          await actor.query(catalogue.listCustomersPage, { pageSize: 20 }),
        ).page,
      ).toEqual([
        { customerId, code: "C-0001", name: "Customer only", status: "ACTIVE" },
      ]);
      expect(
        allowed(await actor.query(catalogue.getCustomer, { customerId })),
      ).toMatchObject({ customerId, name: "Customer only" });
      expect(allowed(await actor.query(catalogue.viewer, {}))).toEqual({
        canManage,
      });
    }
    expect(
      await reader.mutation(writes.createCustomer, {
        requestId: "read-only",
        name: "Denied",
      }),
    ).toMatchObject({ ok: false, denial: { code: "AUTHORIZATION_DENIED" } });
  });

  it("denies a member without customer grants", async () => {
    const { actorA, actorB } = await setup("WAREHOUSE_MANAGER");
    const row = allowed(
      await actorB.mutation(writes.createCustomer, {
        requestId: "owner",
        name: "Customer",
      }),
    );
    if (!row.ok) throw new Error(row.code);
    for (const result of await Promise.all([
      actorA.query(catalogue.getCustomer, { customerId: row.customerId }),
      actorA.query(catalogue.listCustomersPage, { pageSize: 20 }),
      actorA.query(catalogue.findSimilarCustomers, { name: "Customer" }),
      actorA.query(catalogue.suggestCustomerCode, {}),
      actorA.query(catalogue.viewer, {}),
      actorA.mutation(writes.createCustomer, {
        requestId: "denied",
        name: "Customer",
      }),
    ])) {
      expect(result).toMatchObject({
        ok: false,
        denial: { code: "AUTHORIZATION_DENIED" },
      });
    }
  });

  it("archives, restores and protects versions with replay checked before status and version", async () => {
    const { actorA, create } = await setup();
    const { customerId } = await create({
      requestId: "lifecycle",
      name: "Customer",
    });
    const archive = { customerId, requestId: "archive", expectedVersion: 1 };
    expect(
      allowed(await actorA.mutation(writes.archiveCustomer, archive)),
    ).toEqual({ ok: true, customerId, replayed: false });
    expect(
      allowed(await actorA.mutation(writes.archiveCustomer, archive)),
    ).toEqual({ ok: true, customerId, replayed: true });
    expect(
      allowed(
        await actorA.mutation(writes.archiveCustomer, {
          ...archive,
          requestId: "again",
          expectedVersion: 2,
        }),
      ),
    ).toMatchObject({ ok: false, code: "CUSTOMER_ALREADY_ARCHIVED" });
    expect(
      allowed(
        await actorA.query(catalogue.listCustomersPage, {
          status: "ACTIVE",
          pageSize: 20,
        }),
      ).page,
    ).toEqual([]);
    expect(
      allowed(await actorA.query(catalogue.listCustomersPage, { pageSize: 20 }))
        .page,
    ).toHaveLength(1);
    expect(
      allowed(await actorA.query(catalogue.getCustomer, { customerId })),
    ).toMatchObject({
      status: "ARCHIVED",
      version: 2,
      archivedAt: expect.any(Number),
      archivedByUserId: expect.any(String),
    });
    expect(
      allowed(
        await actorA.mutation(writes.updateCustomer, {
          ...archive,
          requestId: "update",
          expectedVersion: 2,
          name: "Updated",
        }),
      ),
    ).toEqual({ ok: false, code: "CUSTOMER_ARCHIVED" });

    const restore = { customerId, requestId: "restore", expectedVersion: 2 };
    expect(
      allowed(await actorA.mutation(writes.restoreCustomer, restore)),
    ).toEqual({ ok: true, customerId, replayed: false });
    expect(
      allowed(await actorA.mutation(writes.restoreCustomer, restore)),
    ).toEqual({ ok: true, customerId, replayed: true });
    expect(
      allowed(
        await actorA.mutation(writes.restoreCustomer, {
          ...restore,
          requestId: "again",
          expectedVersion: 3,
        }),
      ),
    ).toMatchObject({ ok: false, code: "CUSTOMER_ALREADY_ACTIVE" });
    const active = allowed(
      await actorA.query(catalogue.getCustomer, { customerId }),
    );
    expect(active).toMatchObject({ status: "ACTIVE", version: 3 });
    expect(active).not.toHaveProperty("archivedAt");
    expect(active).not.toHaveProperty("archivedByUserId");

    const update = {
      customerId,
      requestId: "update",
      expectedVersion: 3,
      name: "Updated",
    };
    expect(
      allowed(
        await actorA.mutation(writes.updateCustomer, {
          ...update,
          expectedVersion: 2,
        }),
      ),
    ).toEqual({ ok: false, code: "VERSION_CONFLICT" });
    expect(
      allowed(await actorA.mutation(writes.updateCustomer, update)),
    ).toEqual({ ok: true, customerId, replayed: false });
    expect(
      allowed(await actorA.mutation(writes.updateCustomer, update)),
    ).toEqual({ ok: true, customerId, replayed: true });
    expect(
      allowed(
        await actorA.query(catalogue.listCustomersPage, {
          status: "ACTIVE",
          pageSize: 20,
        }),
      ).page,
    ).toEqual([
      { customerId, code: "C-0001", name: "Updated", status: "ACTIVE" },
    ]);
    expect(
      allowed(await actorA.query(catalogue.getCustomer, { customerId })),
    ).toMatchObject({ version: 4 });
  });

  it("replays a create without allocating another code and rejects an altered replay", async () => {
    const { actorA, create, t } = await setup();
    const args = { requestId: "same", name: "Customer" };
    const first = await create(args);
    expect(await create(args)).toEqual({ ...first, replayed: true });
    expect(
      allowed(
        await actorA.mutation(writes.createCustomer, {
          ...args,
          name: "Altered",
        }),
      ),
    ).toEqual({ ok: false, code: "REQUEST_ARGUMENT_CONFLICT" });
    expect(
      await t.run((ctx) => ctx.db.query("customers").collect()),
    ).toHaveLength(1);
    expect(allowed(await actorA.query(catalogue.suggestCustomerCode, {}))).toBe(
      "C-0002",
    );
  });

  it("trims display names and optional text on create and update while preserving the inner text", async () => {
    const { actorA, create } = await setup();
    const { customerId } = await create({
      requestId: "trim-create",
      name: " กิ่ง   Ａcme ",
      legalNameTh: "  บริษัท  กิ่ง ",
      legalNameEn: " Ａcme  Co. ",
      notes: " \nLine  One\nLine Two \t ",
      deliveryAddress: {
        label: " HQ  EAST ",
        line: " 123  Ａ Road ",
        subdistrict: " แขวง  นา ",
        district: " เขต  นา ",
        province: " Bangkok ",
        postcode: " 10100 ",
      },
      contact: {
        name: " Ａda  Lovelace ",
        role: " SALES ",
        phone: " +66  123 ",
        email: " SALES@example.test ",
      },
    });
    expect(
      allowed(await actorA.query(catalogue.getCustomer, { customerId })),
    ).toMatchObject({
      name: "กิ่ง   Ａcme",
      normalizedName: "กิ่ง acme",
      legalNameTh: "บริษัท  กิ่ง",
      legalNameEn: "Ａcme  Co.",
      notes: "Line  One\nLine Two",
      deliveryAddress: {
        label: "HQ  EAST",
        line: "123  Ａ Road",
        subdistrict: "แขวง  นา",
        district: "เขต  นา",
        province: "Bangkok",
        postcode: "10100",
      },
      contact: {
        name: "Ａda  Lovelace",
        role: "SALES",
        phone: "+66  123",
        email: "SALES@example.test",
      },
    });
    const notes = "x".repeat(2000);
    expect(
      allowed(
        await actorA.mutation(writes.updateCustomer, {
          requestId: "trim-update",
          customerId,
          expectedVersion: 1,
          name: "  Customer  Ｂ  ",
          legalNameTh: " \t ",
          legalNameEn: " Second  Ｃompany ",
          notes: ` ${notes} `,
          deliveryAddress: { line: "  Second  Address ", province: "  " },
          contact: { name: " New  Person ", phone: " \n " },
        }),
      ),
    ).toEqual({ ok: true, customerId, replayed: false });
    const updated = allowed(
      await actorA.query(catalogue.getCustomer, { customerId }),
    );
    expect(updated).not.toHaveProperty("legalNameTh");
    expect(updated).toMatchObject({
      name: "Customer  Ｂ",
      legalNameEn: "Second  Ｃompany",
      notes,
    });
    expect(updated?.deliveryAddress).toEqual({ line: "Second  Address" });
    expect(updated?.contact).toEqual({ name: "New  Person" });
  });

  it("checks the display-name length after trimming surrounding whitespace", async () => {
    const { actorA, create } = await setup();
    const name = "ก".repeat(197) + "  Ａ";
    const { customerId } = await create({
      requestId: "trim-boundary",
      name: ` \t${name} \n`,
    });
    expect(
      allowed(await actorA.query(catalogue.getCustomer, { customerId })),
    ).toMatchObject({ name });
    const tooLong = allowed(
      await actorA.mutation(writes.updateCustomer, {
        requestId: "trim-too-long",
        customerId,
        expectedVersion: 1,
        name: ` ${name}ก `,
      }),
    );
    expect(tooLong).toEqual({
      ok: false,
      code: "FIELD_INVALID",
      field: "name",
    });
  });

  it("fully replaces editable fields and records private fields only as change markers", async () => {
    const { actorA, create, t, orgA } = await setup();
    const privateValues = {
      contact: {
        name: "Private Person",
        phone: "020000021",
        email: "private@example.test",
      },
      deliveryAddress: { line: "Confidential address", postcode: "92734" },
      taxId: "0105553012341",
      notes: "Sensitive notes",
    };
    const { customerId } = await create({
      requestId: "private",
      name: "Customer",
      code: "UNCHANGED",
      legalNameTh: " Thai display spacing ",
      legalNameEn: " English display spacing ",
      establishment: { kind: "BRANCH", code: "00001" },
      ...privateValues,
    });
    const initial = allowed(
      await actorA.query(catalogue.getCustomer, { customerId }),
    );
    expect(initial).toMatchObject({
      legalNameTh: "Thai display spacing",
      legalNameEn: "English display spacing",
      establishment: { kind: "BRANCH", code: "00001" },
      taxIdChecksumValid: true,
    });
    const update = {
      customerId,
      requestId: "unchanged-private",
      expectedVersion: 1,
      name: "Renamed",
    };
    await actorA.mutation(writes.updateCustomer, {
      ...update,
      ...privateValues,
    });
    await actorA.mutation(writes.updateCustomer, {
      ...update,
      requestId: "replace",
      expectedVersion: 2,
      name: "Replacement",
      contact: { name: "New private person" },
    });
    const row = allowed(
      await actorA.query(catalogue.getCustomer, { customerId }),
    );
    expect(row).toMatchObject({
      code: "UNCHANGED",
      name: "Replacement",
      contact: { name: "New private person" },
    });
    for (const field of [
      "legalNameTh",
      "legalNameEn",
      "establishment",
      "taxId",
      "taxIdChecksumValid",
      "deliveryAddress",
      "notes",
    ]) {
      expect(row).not.toHaveProperty(field);
    }
    expect(row?.contact).toEqual({ name: "New private person" });

    const audit = await t.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_orgId_occurredAt", (q) => q.eq("orgId", orgA))
        .collect(),
    );
    const customerEvents = audit.filter((event) =>
      event.action.startsWith("customer."),
    );
    expect(customerEvents).toHaveLength(3);
    const redacted = (requestId: string) =>
      customerEvents
        .find((event) => event.requestId === requestId)
        ?.changes?.filter((change) =>
          Object.hasOwn(privateValues, change.field),
        );
    const markers = ["contact", "deliveryAddress", "taxId", "notes"].map(
      (field) => ({ field }),
    );
    expect(redacted("private")).toEqual(expect.arrayContaining(markers));
    expect(redacted("unchanged-private")).toEqual([]);
    expect(redacted("replace")).toEqual(expect.arrayContaining(markers));
    const payload = JSON.stringify(audit);
    for (const secret of [
      "Private Person",
      "020000021",
      "private@example.test",
      "Confidential address",
      "92734",
      "0105553012341",
      "Sensitive notes",
      "New private person",
    ]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("returns only customer summaries in the list and full fields in detail", async () => {
    const { actorA, create } = await setup();
    const privateFields = {
      legalNameTh: "ชื่อบริษัท",
      legalNameEn: "Private legal name",
      taxId: "0105553012341",
      establishment: { kind: "HEAD_OFFICE" as const },
      deliveryAddress: { line: "Private address", province: "Bangkok" },
      contact: { name: "Private contact", phone: "020000021" },
      notes: "Private notes",
    };
    const first = await create({
      requestId: "summary-fields",
      code: "FIRST",
      name: "First",
      ...privateFields,
    });
    const second = await create({ requestId: "no-province", name: "Second" });

    expect(
      allowed(await actorA.query(catalogue.listCustomersPage, { pageSize: 20 }))
        .page,
    ).toEqual([
      {
        customerId: first.customerId,
        code: "FIRST",
        name: "First",
        status: "ACTIVE",
        province: "Bangkok",
      },
      {
        customerId: second.customerId,
        code: "C-0001",
        name: "Second",
        status: "ACTIVE",
      },
    ]);
    expect(
      allowed(
        await actorA.query(catalogue.getCustomer, {
          customerId: first.customerId,
        }),
      ),
    ).toMatchObject({ ...privateFields, taxIdChecksumValid: true });
  });

  it("finds case-insensitive substrings and matches only a complete tax ID", async () => {
    const { actorA, create } = await setup();
    const { customerId } = await create({
      requestId: "search",
      code: "SERV-001",
      name: "อรุณ  Sunrise",
      legalNameTh: " บริษัท ทดสอบ ",
      legalNameEn: "Sunny Manufacturing Ltd",
      taxId: "0105553012341",
    });
    for (const search of [
      "erv-0",
      "รุณ sunrise",
      "ทดสอบ",
      "MANUFACTUR",
      "0-1055-53012-34-1",
    ]) {
      const result = allowed(
        await actorA.query(catalogue.listCustomersPage, {
          search,
          pageSize: 20,
        }),
      );
      expect(result.page.map((row) => row.customerId)).toEqual([customerId]);
    }
    for (const search of ["010555301234", "0105553012342"]) {
      const result = allowed(
        await actorA.query(catalogue.listCustomersPage, {
          search,
          pageSize: 20,
        }),
      );
      expect(result.page).toEqual([]);
    }
  });

  it("limits similar customers to five prefix matches across statuses and omits self", async () => {
    const { actorA, create } = await setup();
    const exact = await create({ requestId: "exact", name: "Ａcme" });
    const archived = await create({ requestId: "archived", name: "Acme a" });
    await actorA.mutation(writes.archiveCustomer, {
      requestId: "archive",
      customerId: archived.customerId,
      expectedVersion: 1,
    });
    for (let index = 0; index < 6; index += 1) {
      await create({ requestId: `candidate-${index}`, name: `Acme b${index}` });
    }
    await create({ requestId: "contains", name: "A new Acme" });
    const similar = allowed(
      await actorA.query(catalogue.findSimilarCustomers, { name: " acMe  " }),
    );
    expect(similar).toHaveLength(5);
    expect(similar[0]).toEqual({
      customerId: exact.customerId,
      code: "C-0001",
      name: "Ａcme",
      status: "ACTIVE",
    });
    expect(similar[1]).toMatchObject({
      customerId: archived.customerId,
      status: "ARCHIVED",
    });
    const excluded = allowed(
      await actorA.query(catalogue.findSimilarCustomers, {
        name: "acme",
        excludeCustomerId: exact.customerId,
      }),
    );
    expect(excluded).toHaveLength(5);
    expect(excluded[0]?.customerId).toBe(archived.customerId);
    expect(
      allowed(
        await actorA.query(catalogue.findSimilarCustomers, { name: " " }),
      ),
    ).toEqual([]);
  });

  it("settles 19 of 100 matches within the customer read and call budget", async () => {
    const world = await seedCustomerSearch((index) => index < 19);
    const { result, requests, stats } = await settlePage<ListPage>(
      world,
      listCustomersPage,
      searchArgs,
      100,
    );
    const measuredBudget = {
      calls: requests,
      scannedRows: stats.rangeDocs.customers,
      retainedIdReads: stats.gets.customers ?? 0,
    };
    expect(result.status).toBe("ready");
    expect(result.isDone).toBe(true);
    expect(result.page.map((row) => row.customerId)).toEqual(
      world.ids.slice(0, 19),
    );
    expect(measuredBudget.scannedRows).toBe(100);
    expect(
      measuredBudget.calls,
      JSON.stringify(measuredBudget),
    ).toBeLessThanOrEqual(5);
    expect(
      measuredBudget.retainedIdReads,
      JSON.stringify(measuredBudget),
    ).toBeLessThanOrEqual(19);
  });

  it("settles an exactly full last filtered page without offering Next", async () => {
    const world = await seedCustomerSearch(
      (index) => index >= 60 && index < 80,
    );
    const { result, requests, stats } = await settlePage<ListPage>(
      world,
      listCustomersPage,
      searchArgs,
    );
    expect(result).toMatchObject({
      status: "ready",
      isDone: true,
      continueCursor: "",
    });
    expect(result.page.map((row) => row.customerId)).toEqual(
      world.ids.slice(60, 80),
    );
    expect(requests).toBe(5);
    expect(stats.rangeDocs.customers).toBe(100);
  });

  it("carries a surplus match found during lookahead into the next page", async () => {
    const world = await seedCustomerSearch(
      (index) => index >= 60 && index <= 80,
    );
    const first = await settlePage<ListPage>(
      world,
      listCustomersPage,
      searchArgs,
    );
    expect(first.result).toMatchObject({ status: "ready", isDone: false });
    expect(first.result.page.map((row) => row.customerId)).toEqual(
      world.ids.slice(60, 80),
    );
    expect(first.requests).toBe(5);

    const next = await settlePage<ListPage>(world, listCustomersPage, {
      ...searchArgs,
      cursor: first.result.continueCursor,
    });
    expect(next.result).toMatchObject({
      status: "ready",
      isDone: true,
      continueCursor: "",
    });
    expect(next.result.page.map((row) => row.customerId)).toEqual(
      world.ids.slice(80, 81),
    );
    expect(next.stats.rangeDocs.customers ?? 0).toBe(0);
  });

  it("settles 20 of 100 early matches without offering Next after a long tail", async () => {
    const world = await seedCustomerSearch((index) => index < 20);
    let scanCursor: string | undefined;
    for (let call = 1; call <= 5; call++) {
      const { value, stats } = await measured<ListPage>(
        world,
        listCustomersPage,
        { ...searchArgs, ...(scanCursor ? { scanCursor } : {}) },
      );
      expect(stats.ranges.customers ?? 0).toBeLessThanOrEqual(1);
      expect(stats.rangeDocs.customers ?? 0).toBeLessThanOrEqual(20);
      expect(stats.gets.customers ?? 0).toBeLessThanOrEqual(20);
      if (value.status !== "scanning") {
        expect(value).toMatchObject({
          status: "ready",
          isDone: true,
          continueCursor: "",
          scanned: 100,
        });
        expect(value.page.map((row) => row.customerId)).toEqual(
          world.ids.slice(0, 20),
        );
        return;
      }
      expect(value.scanCursor).toBeTruthy();
      scanCursor = value.scanCursor;
    }
    throw new Error("Customer lookahead did not settle within five calls");
  });

  it("offers Next when the last indexed customer is the 21st match", async () => {
    const world = await seedCustomerSearch(
      (index) => index < 20 || index === 99,
    );
    const first = await settlePage<ListPage>(
      world,
      listCustomersPage,
      searchArgs,
      5,
    );
    expect(first.result).toMatchObject({ status: "ready", isDone: false });
    expect(first.result.continueCursor).toBeTruthy();
    expect(first.result.page.map((row) => row.customerId)).toEqual(
      world.ids.slice(0, 20),
    );
    expect(first.stats.rangeDocs.customers).toBe(100);

    const next = await settlePage<ListPage>(world, listCustomersPage, {
      ...searchArgs,
      cursor: first.result.continueCursor,
    });
    expect(next.result).toMatchObject({
      status: "ready",
      isDone: true,
      continueCursor: "",
    });
    expect(next.result.page.map((row) => row.customerId)).toEqual(
      world.ids.slice(99),
    );
    expect(next.requests).toBe(1);
    expect(next.stats.rangeDocs.customers ?? 0).toBe(0);
  });

  it("invalidates a scan when an already-scanned customer becomes eligible", async () => {
    const world = await seedCustomerSearch(
      (index) => index < 19 || index === 99,
    );
    const { actorA, ids } = world;
    const first = allowed(
      await actorA.query(catalogue.listCustomersPage, searchArgs),
    );
    expect(first.status).toBe("scanning");
    expect(first.scanned).toBe(20);
    const update = allowed(
      await actorA.mutation(writes.updateCustomer, {
        requestId: "new-match",
        customerId: ids[19]!,
        expectedVersion: 1,
        name: "Customer 19",
        legalNameEn: "needle",
      }),
    );
    expect(update).toMatchObject({ ok: true, replayed: false });

    const lookahead = allowed(
      await actorA.query(catalogue.listCustomersPage, searchArgs),
    );
    expect(lookahead.status).toBe("scanning");
    if (!lookahead.scanCursor) throw new Error("Missing lookahead scan cursor");
    const fresh = await settlePage<ListPage>(
      world,
      listCustomersPage,
      searchArgs,
    );
    expect(fresh.result.page.map((row) => row.customerId)).toEqual(
      ids.slice(0, 20),
    );
    const stale = await settlePage<ListPage>(world, listCustomersPage, {
      ...searchArgs,
      scanCursor: first.scanCursor,
    });
    expect(stale.result).toMatchObject({ status: "reset", page: [] });

    expect(fresh.result.status).toBe("ready");
    expect(fresh.result.continueCursor).toBeTruthy();
    await actorA.mutation(writes.archiveCustomer, {
      requestId: "archive-new-match",
      customerId: ids[19]!,
      expectedVersion: 2,
    });
    expect(
      allowed(
        await actorA.query(catalogue.listCustomersPage, {
          ...searchArgs,
          scanCursor: lookahead.scanCursor,
        }),
      ),
    ).toMatchObject({ status: "reset", page: [] });
    expect(
      allowed(
        await actorA.query(catalogue.listCustomersPage, {
          ...searchArgs,
          cursor: fresh.result.continueCursor,
        }),
      ),
    ).toMatchObject({ status: "reset", page: [] });
  });

  it("keeps a page-two cursor through notes, contact and address edits and resets it after a rename or archive", async () => {
    const world = await seedCustomerSearch(
      (index) => index !== 19 && index !== 40,
    );
    const { actorA, ids } = world;
    const { result: first } = await settlePage<ListPage>(
      world,
      listCustomersPage,
      searchArgs,
    );
    expect(first.continueCursor).toBeTruthy();
    const secondPage = (cursor: string) =>
      settlePage<ListPage>(world, listCustomersPage, { ...searchArgs, cursor });
    const customerId = ids[21]!;
    const update = async (
      expectedVersion: number,
      changes: Partial<CustomerEditableInput>,
    ) =>
      expect(
        allowed(
          await actorA.mutation(writes.updateCustomer, {
            requestId: `edit-for-cursor-${expectedVersion}`,
            customerId,
            expectedVersion,
            name: "Customer 21",
            legalNameEn: "needle",
            ...changes,
          }),
        ),
      ).toEqual({ ok: true, customerId, replayed: false });

    const notes = { notes: "New notes" };
    const contact = { contact: { name: "New contact" } };
    const deliveryAddress = {
      deliveryAddress: { line: "New address", province: "Bangkok" },
    };
    const expectedIds = ids.slice(21, 40).concat(ids[41]!);
    const edits: Partial<CustomerEditableInput>[] = [
      notes,
      { ...notes, ...contact },
      { ...notes, ...contact, ...deliveryAddress },
    ];
    for (const [index, fields] of edits.entries()) {
      await update(index + 1, fields);
      const { result } = await secondPage(first.continueCursor);
      expect(result.status).toBe("ready");
      expect(result.page.map((row) => row.customerId)).toEqual(expectedIds);
      expect(result.page[0]?.province).toBe(fields.deliveryAddress?.province);
    }

    await update(4, {
      name: "Renamed customer",
      ...notes,
      ...contact,
      ...deliveryAddress,
    });
    expect((await secondPage(first.continueCursor)).result).toMatchObject({
      status: "reset",
      page: [],
    });
    const { result: renamed } = await settlePage<ListPage>(
      world,
      listCustomersPage,
      searchArgs,
    );
    expect(renamed.continueCursor).toBeTruthy();
    expect(
      allowed(
        await actorA.mutation(writes.archiveCustomer, {
          requestId: "archive-for-cursor",
          customerId,
          expectedVersion: 5,
        }),
      ),
    ).toEqual({ ok: true, customerId, replayed: false });
    expect((await secondPage(renamed.continueCursor)).result).toMatchObject({
      status: "reset",
      page: [],
    });
  });

  it("carries surplus matches across page boundaries in index order", async () => {
    const world = await seedCustomerSearch(
      (index) => index !== 19 && index !== 40,
    );
    const pages: ListPage["page"][] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const { result } = await settlePage<ListPage>(world, listCustomersPage, {
        ...searchArgs,
        ...(cursor ? { cursor } : {}),
      });
      expect(result.status).toBe("ready");
      pages.push(result.page);
      cursor = result.continueCursor;
      if (result.isDone) break;
    }
    expect(pages.map((rows) => rows.length)).toEqual([20, 20, 20, 20, 18]);
    expect(pages.flat().map((row) => row.customerId)).toEqual(
      world.ids.filter((_, index) => index !== 19 && index !== 40),
    );
  });

  it("keeps scanning past a native split caused by large customer records", async () => {
    const world = await seedCustomerSearch(
      (index) => index !== 50,
      "ก".repeat(2000),
    );
    const { result, requests } = await settlePage<ListPage>(
      world,
      listCustomersPage,
      {
        ...searchArgs,
        pageSize: 100,
      },
    );
    expect(requests).toBeGreaterThan(1);
    expect(result.status).toBe("ready");
    expect(result.isDone).toBe(true);
    expect(result.page.map((row) => row.customerId)).toEqual(
      world.ids.filter((_, index) => index !== 50),
    );
  });

  it("advances bounded scan and page cursors in normalized-name order", async () => {
    const { actorA, actorB, t, orgA, userA } = await setup();
    await t.run(async (ctx) => {
      for (let index = 59; index >= 0; index -= 1) {
        const number = String(index).padStart(2, "0");
        const name = `${number} ${index % 2 ? "needle" : "other"}`;
        await ctx.db.insert("customers", {
          orgId: orgA,
          code: `FIXTURE-${number}`,
          name,
          normalizedName: name,
          status: "ACTIVE",
          version: 1,
          createdAt: 0,
          updatedAt: 0,
          createdByUserId: userA,
          updatedByUserId: userA,
        });
      }
    });
    const args = { pageSize: 20, search: "needle", status: "ACTIVE" as const };
    const names: string[] = [];
    let cursor: string | undefined;
    let scanCursor: string | undefined;
    let scanned = 0;
    let scanning = 0;
    for (let attempts = 0; attempts < 20; attempts += 1) {
      const result = allowed(
        await actorA.query(catalogue.listCustomersPage, {
          ...args,
          ...(cursor ? { cursor } : {}),
          ...(scanCursor ? { scanCursor } : {}),
        }),
      );
      expect(result.status).not.toBe("reset");
      expect(result.scanned - scanned).toBeLessThanOrEqual(20);
      if (result.status === "scanning") {
        expect(result.page).toEqual([]);
        scanCursor = result.scanCursor;
        expect(scanCursor).toBeTruthy();
        scanned = result.scanned;
        scanning += 1;
        continue;
      }
      names.push(...result.page.map((row) => row.name));
      expect(result.page.length).toBeLessThanOrEqual(20);
      if (result.isDone) break;
      cursor = result.continueCursor;
      scanCursor = undefined;
      scanned = 0;
    }
    expect(scanning).toBeGreaterThan(0);
    expect(names).toEqual(
      Array.from(
        { length: 30 },
        (_, index) => `${String(index * 2 + 1).padStart(2, "0")} needle`,
      ),
    );
    if (!cursor) throw new Error("Missing continuation cursor");
    expect(
      allowed(
        await actorB.query(catalogue.listCustomersPage, { ...args, cursor }),
      ).status,
    ).toBe("reset");
    expect(
      allowed(
        await actorA.query(catalogue.listCustomersPage, {
          ...args,
          search: "other",
          cursor,
        }),
      ).status,
    ).toBe("reset");
    expect(
      allowed(
        await actorA.query(catalogue.listCustomersPage, { pageSize: 1000 }),
      ).status,
    ).toBe("reset");
  });
});

describe("customer authorization upgrade", () => {
  const planner = PLANNER_PERMISSION_CODES;
  const plannerHr = [...planner, ...HR_ADMIN_PERMISSION_CODES];
  const plannerAi = [...planner, ...AI_USAGE_PERMISSION_CODES];
  const preCustomers = [...plannerHr, ...AI_USAGE_PERMISSION_CODES];
  const current = [...preCustomers, ...CUSTOMER_PERMISSION_CODES];
  const withCustomers = (codes: readonly string[]) => [
    ...codes,
    ...CUSTOMER_PERMISSION_CODES,
  ];

  it.each([
    ["customers", "hr", "ai"],
    ["customers", "ai", "hr"],
    ["hr", "customers", "ai"],
    ["hr", "ai", "customers"],
    ["ai", "customers", "hr"],
    ["ai", "hr", "customers"],
  ] as const)(
    "preserves baseline eligibility in provisioner order %s → %s → %s",
    async (...order) => {
      const { t, orgA, orgB } = await setup();
      const cases = [
        { key: "legacy", codes: planner },
        { key: "hr-stripped", codes: plannerAi },
        { key: "hr-stripped-with-customers", codes: withCustomers(plannerAi) },
        { key: "ai-stripped", codes: plannerHr },
        { key: "ai-stripped-with-customers", codes: withCustomers(plannerHr) },
        { key: "renamed", codes: preCustomers, name: "Renamed administrator" },
        { key: "renamed-planner", codes: planner, name: "Renamed planner" },
        {
          key: "renamed-planner-with-customers",
          codes: withCustomers(planner),
          name: "Renamed planner",
        },
        {
          key: "renamed-hr-with-customers",
          codes: withCustomers(plannerHr),
          name: "Renamed administrator",
        },
        {
          key: "custom-description",
          codes: preCustomers,
          description: "Restricted for this tenant.",
        },
        {
          key: "partial",
          codes: [...preCustomers, "masterData.customer.read"],
        },
        { key: "duplicate", codes: [...preCustomers, "aiUsage.read"] },
        { key: "inactive", codes: preCustomers, status: "ARCHIVED" as const },
        { key: "unseeded", codes: preCustomers, seeded: false },
        { key: "no-description", codes: preCustomers },
        {
          key: "planner-description",
          codes: preCustomers,
          description: "Manages building and storage plans.",
        },
        {
          key: "attendance-description",
          codes: preCustomers,
          description: "Manages building and storage plans and HR attendance.",
        },
        {
          key: "all-permissions-description",
          codes: preCustomers,
          description: "Tenant administrator with every tenant permission.",
        },
        {
          key: "system-admin-description",
          codes: preCustomers,
          description:
            "Tenant system administrator; sensitive team HR and payroll access is separate.",
        },
      ];
      const fixtures = new Map(
        await t.run(async (ctx) => {
          const fixtures: [
            string,
            { orgId: Id<"organizations">; roleId: Id<"roles"> },
          ][] = [];
          for (const fixture of cases) {
            const orgId = await ctx.db.insert("organizations", {
              clerkOrganizationId: `org_provision_${fixture.key}`,
              name: fixture.key,
              status: "ACTIVE",
              settings: DEFAULT_ORGANIZATION_SETTINGS,
            });
            const roleId = await ctx.db.insert("roles", {
              orgId,
              key: "ORG_ADMIN",
              name: fixture.name ?? "Organization administrator",
              ...(fixture.description === undefined
                ? {}
                : { description: fixture.description }),
              seeded: fixture.seeded ?? true,
              status: fixture.status ?? "ACTIVE",
            });
            for (const permissionCode of fixture.codes)
              await ctx.db.insert("rolePermissions", {
                orgId,
                roleId,
                permissionCode,
              });
            fixtures.push([fixture.key, { orgId, roleId }]);
          }
          return fixtures;
        }),
      );
      const upgrade = internal.customers.provision.upgradeOrgAdminRoles;
      const verify = internal.customers.provision.verifyOrgAdminGrants;
      const ai = internal.aiUsage.provision.organization;
      const provisionHr = async (orgId: Id<"organizations">) =>
        (await t.run((ctx) => provisionHrForOrganization(ctx, orgId))).orgAdmin;
      const eligible = [
        "no-description",
        "planner-description",
        "attendance-description",
        "all-permissions-description",
        "system-admin-description",
      ];
      const expectedCodes = new Map(
        cases.map(({ key, codes }) => [key, codes]),
      );
      const checked = new Set<string>();
      for (const step of order) {
        if (step === "customers") {
          const eligibleNow = new Set(eligible);
          if (checked.has("ai")) {
            eligibleNow.add("ai-stripped");
            if (checked.has("hr") && order.indexOf("hr") < order.indexOf("ai"))
              eligibleNow.add("legacy");
          }
          const expectedReview = cases
            .filter(({ key }) => !eligibleNow.has(key))
            .map(({ key }) => fixtures.get(key)!.orgId);
          const before = await t.query(verify, {});
          expect(
            before.page
              .filter(({ status }) => status === "eligible")
              .map(({ orgId }) => orgId)
              .sort(),
          ).toEqual(
            [...eligibleNow].map((key) => fixtures.get(key)!.orgId).sort(),
          );
          const first = await t.mutation(upgrade, {});
          expect(first).toMatchObject({
            upgraded: eligibleNow.size,
            current: 2,
            customized: expectedReview.length,
            missing: 0,
          });
          expect([...first.customizedOrgIds].sort()).toEqual(
            expectedReview.sort(),
          );
          expect(await t.mutation(upgrade, {})).toMatchObject({
            upgraded: 0,
            current: eligibleNow.size + 2,
            customized: expectedReview.length,
          });
          for (const key of eligibleNow) {
            expectedCodes.set(key, current);
          }
          const after = await t.query(verify, {});
          expect(
            after.page.map(({ orgId, status }) => [orgId, status]),
          ).toEqual(
            before.page.map(({ orgId, status }) => [
              orgId,
              status === "eligible" ? "current" : status,
            ]),
          );
        } else {
          const run =
            step === "hr"
              ? provisionHr
              : (orgId: Id<"organizations">) => t.mutation(ai, { orgId });
          expect(await run(orgA)).toBe("CURRENT");
          expect(await run(orgB)).toBe("CURRENT");
          for (const { key } of cases) {
            let expected = "CURRENT";
            if (key === "hr-stripped" || key === "hr-stripped-with-customers")
              expected = "CUSTOMIZED";
            if (key === "legacy" || key === "renamed-planner") {
              expected =
                step === "hr" || checked.has("hr") ? "UPGRADED" : "CUSTOMIZED";
              if (expected === "UPGRADED")
                expectedCodes.set(
                  key,
                  step === "hr" ? plannerHr : preCustomers,
                );
            }
            if (key === "ai-stripped" && step === "ai") {
              expected = "UPGRADED";
              expectedCodes.set(key, preCustomers);
            }
            if (step === "ai" && key === "ai-stripped-with-customers")
              expected = "CUSTOMIZED";
            if (step === "ai" && key === "renamed-hr-with-customers")
              expected = "CUSTOMIZED";
            if (key === "partial" || key === "renamed-planner-with-customers")
              expected = "CUSTOMIZED";
            const { orgId } = fixtures.get(key)!;
            expect(await run(orgId), `${step}: ${key}`).toBe(expected);
            if (expected === "UPGRADED")
              expect(await run(orgId), `rerun ${step}: ${key}`).toBe("CURRENT");
          }
        }
        checked.add(step);
      }
      for (const { key } of cases) {
        const { orgId, roleId } = fixtures.get(key)!;
        const grants = await t.run((ctx) =>
          ctx.db
            .query("rolePermissions")
            .withIndex("by_orgId_roleId_permissionCode", (q) =>
              q.eq("orgId", orgId).eq("roleId", roleId),
            )
            .collect(),
        );
        expect(
          grants.map(({ permissionCode }) => permissionCode).sort(),
          key,
        ).toEqual([...expectedCodes.get(key)!].sort());
      }
    },
  );

  it("verifies administrator grant state page by page before and after upgrades", async () => {
    const { t, roles, orgA, orgB } = await setup();
    const { customized, missing } = await t.run(async (ctx) => {
      const roleId = roles.rolesA.get("ORG_ADMIN")!;
      const grants = await ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (q) =>
          q.eq("orgId", orgA).eq("roleId", roleId),
        )
        .collect();
      for (const grant of grants)
        if (grant.permissionCode.startsWith("masterData.customer."))
          await ctx.db.delete("rolePermissions", grant._id);

      const ids = [];
      for (let index = 0; index < 51; index++) {
        ids.push(
          await ctx.db.insert("organizations", {
            clerkOrganizationId: `org_check_${String(index).padStart(2, "0")}`,
            name: `Check ${index}`,
            status: "ACTIVE",
            settings: DEFAULT_ORGANIZATION_SETTINGS,
          }),
        );
      }
      const customized = ids[0]!;
      const customRole = await ctx.db.insert("roles", {
        orgId: customized,
        key: "ORG_ADMIN",
        name: "Renamed admin",
        description: "Manages building and storage plans.",
        seeded: true,
        status: "ACTIVE",
      });
      for (const permissionCode of CUSTOMER_PERMISSION_CODES)
        await ctx.db.insert("rolePermissions", {
          orgId: customized,
          roleId: customRole,
          permissionCode,
        });
      return { customized, missing: ids[50]! };
    });
    const verify = internal.customers.provision.verifyOrgAdminGrants;
    const upgrade = internal.customers.provision.upgradeOrgAdminRoles;
    const first = await t.query(verify, {});
    expect(first.isDone).toBe(false);
    expect(first.page).toHaveLength(50);
    expect(first.page[0]).toEqual({
      orgId: customized,
      status: "customized",
      hasCustomerGrants: true,
    });
    const args = { cursor: first.continueCursor };
    const second = await t.query(verify, args);
    expect(second.isDone).toBe(true);
    expect(second.page).toEqual([
      { orgId: missing, status: "missing", hasCustomerGrants: false },
      { orgId: orgA, status: "eligible", hasCustomerGrants: false },
      { orgId: orgB, status: "current", hasCustomerGrants: true },
    ]);
    expect(await t.query(verify, args)).toEqual(second);

    expect(await t.mutation(upgrade, args)).toMatchObject({
      upgraded: 1,
      current: 1,
      missing: 1,
    });
    expect(await t.mutation(upgrade, args)).toMatchObject({
      upgraded: 0,
      current: 2,
      missing: 1,
    });
    expect((await t.query(verify, args)).page).toEqual([
      { orgId: missing, status: "missing", hasCustomerGrants: false },
      { orgId: orgA, status: "current", hasCustomerGrants: true },
      { orgId: orgB, status: "current", hasCustomerGrants: true },
    ]);
    expect(await t.query(verify, {})).toEqual(first);
  });

  it("revokes customer grants in resumable batches, leaves manually granted roles alone and preserves data", async () => {
    const { t, actorA, actorB, create, roles, orgA, orgB } = await setup();
    await create({
      requestId: "customer-before-revocation",
      name: "Saved customer",
    });
    const data = () =>
      t.run(async (ctx) => ({
        customers: await ctx.db.query("customers").collect(),
        catalogueSignals: await ctx.db
          .query("customerCatalogueSignals")
          .collect(),
      }));
    const savedData = await data();
    expect(savedData.customers).toHaveLength(1);
    expect(savedData.catalogueSignals).toHaveLength(1);
    const { customizedOrgId, missingOrgIds } = await t.run(async (ctx) => {
      const roleA = roles.rolesA.get("ORG_ADMIN")!;
      const grants = await ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (q) =>
          q.eq("orgId", orgA).eq("roleId", roleA),
        )
        .collect();
      for (const grant of grants)
        if (
          CUSTOMER_PERMISSION_CODES.some(
            (code) => code === grant.permissionCode,
          )
        )
          await ctx.db.delete("rolePermissions", grant._id);

      const missingOrgIds = [];
      const customizedOrgId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_custom_grants",
        name: "Manually granted customer access",
        status: "ACTIVE",
        settings: DEFAULT_ORGANIZATION_SETTINGS,
      });
      const roleId = await ctx.db.insert("roles", {
        orgId: customizedOrgId,
        key: "ORG_ADMIN",
        name: "Organization administrator",
        description: "Customer access approved separately.",
        seeded: true,
        status: "ACTIVE",
      });
      for (const permissionCode of current)
        await ctx.db.insert("rolePermissions", {
          orgId: customizedOrgId,
          roleId,
          permissionCode,
        });
      for (let i = 0; i < 49; i++)
        missingOrgIds.push(
          await ctx.db.insert("organizations", {
            clerkOrganizationId: `org_custom_missing_${String(i).padStart(2, "0")}`,
            name: "Missing administrator",
            status: "ACTIVE",
            settings: DEFAULT_ORGANIZATION_SETTINGS,
          }),
        );
      return { customizedOrgId, missingOrgIds };
    });
    const { upgradeOrgAdminRoles, revokeOrgAdminGrants, verifyOrgAdminGrants } =
      internal.customers.provision;
    const first = await t.mutation(upgradeOrgAdminRoles, {});
    expect(first).toMatchObject({
      upgraded: 0,
      customized: 1,
      missing: 49,
      isDone: false,
    });
    const args = { cursor: first.continueCursor };
    expect(await t.mutation(upgradeOrgAdminRoles, args)).toMatchObject({
      upgraded: 1,
      current: 1,
      isDone: true,
    });
    const verified = await t.query(verifyOrgAdminGrants, args);
    expect(verified.page).toEqual([
      { orgId: orgA, status: "current", hasCustomerGrants: true },
      { orgId: orgB, status: "current", hasCustomerGrants: true },
    ]);

    const revokeFirst = await t.mutation(revokeOrgAdminGrants, {});
    expect(revokeFirst).toEqual({
      revoked: 0,
      revokedOrgIds: [],
      unchanged: 0,
      unchangedOrgIds: [],
      customized: 1,
      customizedOrgIds: [customizedOrgId],
      missing: 49,
      missingOrgIds,
      isDone: false,
      continueCursor: first.continueCursor,
    });
    const revokeArgs = { cursor: revokeFirst.continueCursor };
    expect(await t.mutation(revokeOrgAdminGrants, revokeArgs)).toMatchObject({
      revoked: 2,
      revokedOrgIds: [orgA, orgB],
      unchanged: 0,
      unchangedOrgIds: [],
      customized: 0,
      customizedOrgIds: [],
      missing: 0,
      missingOrgIds: [],
      isDone: true,
    });
    expect((await t.query(verifyOrgAdminGrants, {})).page[0]).toEqual({
      orgId: customizedOrgId,
      status: "customized",
      hasCustomerGrants: true,
    });
    expect((await t.query(verifyOrgAdminGrants, revokeArgs)).page).toEqual([
      { orgId: orgA, status: "eligible", hasCustomerGrants: false },
      { orgId: orgB, status: "eligible", hasCustomerGrants: false },
    ]);
    for (const actor of [actorA, actorB]) {
      const workspace = allowed(
        await actor.query(api.workspace.current.readCurrent, {}),
      );
      for (const code of CUSTOMER_PERMISSION_CODES)
        expect(workspace.navigationPermissions).not.toContain(code);
    }
    expect(await data()).toEqual(savedData);

    expect(await t.mutation(revokeOrgAdminGrants, {})).toEqual(revokeFirst);
    expect(await t.mutation(revokeOrgAdminGrants, revokeArgs)).toMatchObject({
      revoked: 0,
      revokedOrgIds: [],
      unchanged: 2,
      unchangedOrgIds: [orgA, orgB],
      isDone: true,
    });
    expect(await data()).toEqual(savedData);
  });

  it("resumes bounded batches, exposes upgraded grants and reports older defaults until HR and AI provisioning", async () => {
    const { actorA, actorB, t, roles, orgA, orgB } = await setup();
    const customerOnly = (code: string) =>
      CUSTOMER_PERMISSION_CODES.some((customerCode) => customerCode === code);
    const legacyPlannerOnly = (code: string) =>
      !PLANNER_PERMISSION_CODES.includes(code);

    const fixtureOrgIds = await t.run(async (ctx) => {
      for (const permissionCode of CUSTOMER_PERMISSION_CODES) {
        const definition = await ctx.db
          .query("permissions")
          .withIndex("by_code", (q) => q.eq("code", permissionCode))
          .unique();
        if (!definition) throw new Error("Expected permission");
        await ctx.db.delete("permissions", definition._id);
      }
      for (const [orgId, roleId, remove] of [
        [orgA, roles.rolesA.get("ORG_ADMIN")!, customerOnly],
        [orgB, roles.rolesB.get("ORG_ADMIN")!, legacyPlannerOnly],
      ] as const) {
        const grants = await ctx.db
          .query("rolePermissions")
          .withIndex("by_orgId_roleId_permissionCode", (q) =>
            q.eq("orgId", orgId).eq("roleId", roleId),
          )
          .collect();
        for (const grant of grants) {
          if (remove(grant.permissionCode))
            await ctx.db.delete("rolePermissions", grant._id);
        }
      }
      await ctx.db.patch("roles", roles.rolesB.get("ORG_ADMIN")!, {
        description: "Manages building and storage plans.",
      });

      const orgIds = [];
      for (let index = 0; index < 51; index += 1) {
        const name = `Custom tenant ${index}`;
        const orgId = await ctx.db.insert("organizations", {
          clerkOrganizationId: `org_custom_${index}`,
          name,
          status: "ACTIVE",
          settings: DEFAULT_ORGANIZATION_SETTINGS,
        });
        orgIds.push(orgId);
        if (index >= 4) continue;
        const roleId = await ctx.db.insert("roles", {
          orgId,
          key: "ORG_ADMIN",
          name: index === 3 ? "Renamed admin" : "Organization administrator",
          description: "Manages building and storage plans.",
          seeded: index !== 0,
          status: "ACTIVE",
        });
        const grants = [...PLANNER_PERMISSION_CODES];
        if (index === 1) grants.push("hr.self.access");
        if (index === 2) grants.push("masterData.customer.read");
        for (const permissionCode of grants) {
          await ctx.db.insert("rolePermissions", {
            orgId,
            roleId,
            permissionCode,
          });
        }
      }
      return orgIds;
    });
    expect(await actorA.query(catalogue.suggestCustomerCode, {})).toMatchObject(
      { ok: false },
    );
    const upgrade = internal.customers.provision.upgradeOrgAdminRoles;
    const first = await t.mutation(upgrade, {});
    expect(first).toMatchObject({
      upgraded: 0,
      customized: 4,
      missing: 46,
      isDone: false,
    });
    const second = await t.mutation(upgrade, { cursor: first.continueCursor });
    expect(second).toMatchObject({
      upgraded: 1,
      current: 0,
      customized: 1,
      missing: 1,
      isDone: true,
    });
    expect(first.customizedOrgIds).toHaveLength(4);
    expect([...first.customizedOrgIds].sort()).toEqual(
      fixtureOrgIds.slice(0, 4).sort(),
    );
    expect(first.missingOrgIds).toHaveLength(46);
    expect(second.customizedOrgIds).toEqual([orgB]);
    expect(second.missingOrgIds).toHaveLength(1);
    expect([...first.missingOrgIds, ...second.missingOrgIds].sort()).toEqual(
      fixtureOrgIds.slice(4).sort(),
    );
    expect(await t.mutation(upgrade, {})).toEqual(first);
    expect(
      await t.mutation(upgrade, { cursor: first.continueCursor }),
    ).toMatchObject({
      upgraded: 0,
      current: 1,
      customizedOrgIds: [orgB],
      missingOrgIds: second.missingOrgIds,
      isDone: true,
    });
    expect(
      allowed(await actorA.query(api.workspace.current.readCurrent, {}))
        .navigationPermissions,
    ).toEqual(expect.arrayContaining([...CUSTOMER_PERMISSION_CODES]));
    expect(allowed(await actorA.query(catalogue.suggestCustomerCode, {}))).toBe(
      "C-0001",
    );
    expect(await actorB.query(catalogue.suggestCustomerCode, {})).toMatchObject(
      { ok: false },
    );

    expect(
      await t.run((ctx) => provisionHrForOrganization(ctx, orgB)),
    ).toMatchObject({ orgAdmin: "UPGRADED" });
    expect(
      await t.mutation(internal.aiUsage.provision.organization, {
        orgId: orgB,
      }),
    ).toBe("UPGRADED");
    expect(
      await t.mutation(upgrade, { cursor: first.continueCursor }),
    ).toMatchObject({
      upgraded: 1,
      current: 1,
      customized: 0,
      missing: 1,
    });
    expect(
      await t.mutation(upgrade, { cursor: first.continueCursor }),
    ).toMatchObject({
      upgraded: 0,
      current: 2,
      customizedOrgIds: [],
      missingOrgIds: second.missingOrgIds,
    });
    expect(allowed(await actorB.query(catalogue.suggestCustomerCode, {}))).toBe(
      "C-0001",
    );
    expect(
      allowed(await actorB.query(api.workspace.current.readCurrent, {}))
        .navigationPermissions,
    ).toEqual(expect.arrayContaining([...CUSTOMER_PERMISSION_CODES]));
  });
});
