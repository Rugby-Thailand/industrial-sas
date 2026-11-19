import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { provisionHrForOrganization } from "../../convex/lib/authorizationSeedConvex";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../convex/lib/organizationDefaults";
import {
  CUSTOMER_PERMISSION_CODES,
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
} from "../fixtures/convex-tenant-world";

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
    ).toMatchObject([{ name: "Updated", version: 4 }]);
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

  it("fully replaces editable fields and records private fields only as change markers", async () => {
    const { actorA, create, t, orgA } = await setup();
    const privateValues = {
      contact: {
        name: "Private Person",
        phone: "020000021",
        email: "private@example.test",
      },
      deliveryAddress: { line: "Confidential address", postcode: "10100" },
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
      legalNameTh: " Thai display spacing ",
      legalNameEn: " English display spacing ",
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
      "10100",
      "0105553012341",
      "Sensitive notes",
      "New private person",
    ]) {
      expect(payload).not.toContain(secret);
    }
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
  it("resumes bounded pages, upgrades older defaults, skips customizations and exposes grants", async () => {
    const { actorA, actorB, t, roles, orgA, orgB } = await setup();
    const customerOnly = (code: string) =>
      CUSTOMER_PERMISSION_CODES.some((customerCode) => customerCode === code);
    const legacyPlannerOnly = (code: string) =>
      !PLANNER_PERMISSION_CODES.includes(code);

    await t.run(async (ctx) => {
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

      for (let index = 0; index < 51; index += 1) {
        const name = `Custom tenant ${index}`;
        const orgId = await ctx.db.insert("organizations", {
          clerkOrganizationId: `org_custom_${index}`,
          name,
          status: "ACTIVE",
          settings: DEFAULT_ORGANIZATION_SETTINGS,
        });
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
      upgraded: 2,
      customized: 0,
      missing: 1,
      isDone: true,
    });
    expect(await t.mutation(upgrade, {})).toMatchObject({
      upgraded: 0,
      customized: 4,
      missing: 46,
    });
    expect(
      await t.mutation(upgrade, { cursor: first.continueCursor }),
    ).toMatchObject({ upgraded: 0, current: 2, isDone: true });
    for (const actor of [actorA, actorB]) {
      expect(
        allowed(await actor.query(api.workspace.current.readCurrent, {}))
          .navigationPermissions,
      ).toEqual(expect.arrayContaining([...CUSTOMER_PERMISSION_CODES]));
      expect(
        allowed(await actor.query(catalogue.suggestCustomerCode, {})),
      ).toBe("C-0001");
    }

    expect(
      await t.run((ctx) => provisionHrForOrganization(ctx, orgB)),
    ).toMatchObject({ orgAdmin: "UPGRADED" });
    expect(
      await t.mutation(internal.aiUsage.provision.organization, {
        orgId: orgB,
      }),
    ).toBe("UPGRADED");
    expect(
      allowed(await actorB.query(api.workspace.current.readCurrent, {}))
        .navigationPermissions,
    ).toEqual(expect.arrayContaining([...CUSTOMER_PERMISSION_CODES]));
  });
});
