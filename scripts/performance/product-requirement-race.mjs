#!/usr/bin/env node
/** Real OCC acceptance against an owned, credential-free loopback backend. */
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { withLocalConvex } from "../lib/with-local-convex.mjs";

const rounds = 24;
await withLocalConvex(
  {
    issuer: "https://query-race.invalid",
    fixture: {
      source: new URL(
        "./fixtures/product-requirement-race.ts.txt",
        import.meta.url,
      ),
      module: "raceAcceptance.ts",
    },
  },
  runRace,
);

async function runRace({ admin, key, url }) {
  const identity = {
    subject: "query_race_user",
    issuer: "https://query-race.invalid",
    tokenIdentifier: "https://query-race.invalid|query_race_user",
    org_id: "query_race_org",
  };
  const actor = () => {
    const client = new ConvexHttpClient(url, { logger: false });
    client.setAdminAuth(key, identity);
    return client;
  };
  const writer = actor(),
    reserver = actor();
  const seeded = await admin.mutation("raceAcceptance:initialize", {});
  const fields = {
    name: "Race product",
    unit: "PCS",
    storageFormat: "PALLET",
    defaultQuantity: 500,
    storageCondition: "DRY",
    draft: false,
  };
  const written = (result) => {
    assert.equal(result.ok, true);
    assert.equal(result.value.written, true, JSON.stringify(result));
    return result.value.documentId;
  };
  const wins = { edit: 0, reserve: 0 };
  for (let round = 0; round < rounds; round++) {
    const { warehouseId, zoneId } = await admin.mutation(
      "raceAcceptance:seedRound",
      { ...seeded, round },
    );
    const productId = written(
      await writer.mutation("finishedGoods/workflow:saveProduct", {
        ...fields,
        sku: `RACE-${round}`,
        warehouseId,
        requestId: `product-race-${round}`,
      }),
    );
    const palletId = written(
      await writer.mutation("finishedGoods/workflow:createPallet", {
        warehouseId,
        productId,
        requestId: `pallet-race-${round}`,
      }),
    );
    const initial = await admin.query("raceAcceptance:inspect", {
      productId,
      palletId,
    });
    written(
      await writer.mutation("finishedGoods/workflow:saveMeasurement", {
        warehouseId,
        palletId,
        requestId: `measure-race-${round}`,
        expectedMeasurementUpdatedAt: initial.pallet.updatedAt,
        quantity: 500,
        lengthMm: 1200,
        widthMm: 1000,
        heightMm: 1400,
      }),
    );
    const edit = () =>
      writer.mutation("finishedGoods/workflow:saveProduct", {
        ...fields,
        storageCondition: "COLD",
        sku: `RACE-${round}`,
        warehouseId,
        productId,
        expectedUpdatedAt: initial.product.updatedAt,
        requestId: `edit-race-${round}`,
      });
    const reserve = () =>
      reserver.mutation("finishedGoods/workflow:reserve", {
        warehouseId,
        palletId,
        zoneId,
        requestId: `reserve-race-${round}`,
        xMm: 0,
        yMm: 0,
        rotation: 0,
      });
    // Independent clients avoid the HTTP client's same-client mutation queue.
    const [editResult, reserveResult] =
      round % 2 === 0
        ? await Promise.all([edit(), reserve()])
        : (await Promise.all([reserve(), edit()])).reverse();
    assert.equal(editResult.ok, true);
    assert.equal(reserveResult.ok, true);
    assert.equal(
      Number(editResult.value.written) + Number(reserveResult.value.written),
      1,
      "BOTH_OR_NEITHER_WRITES_COMMITTED",
    );
    const after = await admin.query("raceAcceptance:inspect", {
      productId,
      palletId,
    });
    if (editResult.value.written) {
      wins.edit++;
      assert.equal(
        reserveResult.value.error.code,
        "STORAGE_CONDITION_MISMATCH",
      );
      assert.equal(after.product.storageCondition, "COLD");
      assert.equal(after.pallet.status, "AWAITING_PLACEMENT");
    } else {
      wins.reserve++;
      assert.equal(editResult.value.error.code, "LOCATION_OCCUPIED");
      assert.equal(after.product.storageCondition, "DRY");
      assert.equal(after.pallet.status, "RESERVED");
    }
  }
  assert(
    wins.edit > 0 && wins.reserve > 0,
    "BOTH_SERIALIZATION_ORDERS_NOT_OBSERVED",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        rounds,
        wins,
        incompatibleCommittedPairs: 0,
        backend: "precompiled-2026-10-06-a3538c6",
        note: "Actual concurrent public mutations; no retry-rate or production-load claim.",
      },
      null,
      2,
    ),
  );
}
