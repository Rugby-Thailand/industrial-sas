#!/usr/bin/env node
/** Exercise a live overview while writes move its subscribed page boundary. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { ConvexClient } from "convex/browser";
import { withLocalConvex } from "../lib/with-local-convex.mjs";

const issuer = "https://workspace.invalid";
const customerName = "Overview subscription buyer";
await withLocalConvex({ issuer, allowLocalSeed: true }, verifyGrowth);

async function verifyGrowth({ admin, key, url }) {
  const identity = {
    issuer,
    subject: "workspace_user",
    org_id: "workspace_org",
  };
  const { warehouseId: sourceWarehouseId } = await admin.mutation(
    "staging/annexDemo:bootstrapLocalDemo",
    {
      clerkUserId: identity.subject,
      clerkOrganizationId: identity.org_id,
      displayName: "Workspace tester",
      email: "workspace@example.invalid",
      confirmation: "SEED_DEMO_ANNEX_REALISTIC_2026_09",
      allowLocalTestSeed: true,
    },
  );
  const sites = [];
  for (let i = 0; i < 110; i++) {
    const { warehouseId } = await admin.mutation(
      "staging/hrDemo:createLocalTestSite",
      {
        sourceWarehouseId,
        code: "TRAIN-E2E-" + i.toString(16).padStart(8, "0"),
        confirmation: "LOCAL_HR_FIXTURES_V1",
      },
    );
    sites.push(warehouseId);
  }
  sites.sort();
  const live = new ConvexClient(url, { logger: false });
  live.setAdminAuth(key, identity);
  try {
    const created = await live.mutation("customers/writes:createCustomer", {
      name: customerName,
      requestId: randomUUID(),
    });
    assert.ok(created.ok && created.value.ok);
    const { customerId } = created.value;
    async function addProduct(warehouseId) {
      const result = await live.mutation("finishedGoods/workflow:saveProduct", {
        requestId: randomUUID(),
        warehouseId,
        sku: "BOX",
        name: "Box",
        unit: "BOX",
        draft: false,
        storageFormat: "PALLET",
        storageCondition: "AMBIENT",
        customerLink: { action: "SET", customerId },
      });
      assert.ok(result.ok && result.value.written);
    }
    async function addTicket(warehouseId, factoryOrder) {
      const result = await live.mutation(
        "finishedGoods/jobScans:saveJobScans",
        {
          requestId: randomUUID(),
          warehouseId,
          locationText: "Receiving dock",
          items: [
            {
              source: "MANUAL",
              customer: customerName,
              factoryOrder,
              productBarcodeText: "BOX",
            },
          ],
        },
      );
      assert.ok(result.ok && result.value.written);
    }
    const shell = live.onUpdate(
      "customers/workspace:getCustomerWorkspace",
      { customerId },
      () => {},
    );
    const continuation = (cursor) =>
      live.onUpdate(
        "customers/workspace:continueCustomerOverview",
        { customerId, cursor },
        () => {},
      );
    const current = (subscription) => subscription.getCurrentValue()?.value;
    await expect
      .poll(() => current(shell)?.rollup?.linkedProducts.count)
      .toBe(0);
    for (const warehouse of sites.slice(9)) await addProduct(warehouse);
    await addTicket(sites.at(-1), "ORIGINAL");
    await expect.poll(() => current(shell)?.overviewCursor).toBeTruthy();
    const originalCursor = current(shell).overviewCursor;
    const originalTail = continuation(originalCursor);
    await expect.poll(() => current(originalTail)?.linkedProductCount).toBe(2);
    assert.equal(current(shell).rollup.linkedProducts.count, 99);

    // These warehouse IDs precede the original lookahead. The open first page
    // must change its boundary, and the replacement tail must include displaced rows.
    for (const warehouse of sites.slice(0, 9)) await addProduct(warehouse);
    await addTicket(sites[0], "NEW-FIRST");
    await addTicket(sites.at(-1), "NEW-LAST");
    await expect
      .poll(() => current(shell)?.overviewCursor)
      .not.toBe(originalCursor);
    const tail = continuation(current(shell).overviewCursor);
    await expect.poll(() => current(tail)?.linkedProductCount).toBe(11);
    assert.equal(current(tail).nextCursor, undefined);
    assert.equal(
      current(shell).rollup.linkedProducts.count +
        current(tail).linkedProductCount,
      110,
    );
    const latest = [...current(shell).latestJobs, ...current(tail).latestJobs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .map((job) => job.factoryOrder);
    assert.deepEqual(latest, ["NEW-LAST", "NEW-FIRST", "ORIGINAL"]);
    console.log(
      "Passed live workspace growth from 101 to 110 warehouses with exact product and ticket results.",
    );
  } finally {
    await live.close();
  }
}
