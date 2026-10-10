/**
 * The authenticated staging write flow (T6): layout edit with write/readback,
 * pallet placement and a move, plus tenant/warehouse denials. All writes are
 * namespaced by run and land in the run's own fixture warehouse.
 *
 * Executor-agnostic on purpose: the Playwright staging suite runs it with the
 * signed-in user's Convex token against the real staging deployment, and
 * tests/integration/staging-flow.integration.test.ts runs the identical
 * sequence against convex-test with the shipping functions. Both must pass.
 */

export type Execute = (
  kind: "query" | "mutation",
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

type Outcome = {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly denial?: unknown;
};

export class FlowError extends Error {
  override readonly name = "FlowError";
}

function allowed(step: string, outcome: unknown): unknown {
  const envelope = outcome as Outcome;
  if (!envelope?.ok) throw new FlowError(`${step}: request was denied`);
  return envelope.value;
}

function written(step: string, outcome: unknown): string {
  const value = allowed(step, outcome) as {
    written?: boolean;
    documentId?: string;
    error?: { code?: string };
  };
  if (!value?.written || typeof value.documentId !== "string") {
    throw new FlowError(
      `${step}: not written (${value?.error?.code ?? "unknown"})`,
    );
  }
  return value.documentId;
}

export interface FlowContext {
  readonly runId: string;
  readonly warehouseId: string;
}

export interface FlowResult {
  readonly buildingId: string;
  readonly buildingCode: string;
  readonly buildingName: string;
  readonly sourceZoneCode: string;
  readonly targetZoneCode: string;
  readonly palletId: string;
  readonly productSku: string;
}

export async function runStorageFlow(
  execute: Execute,
  { runId, warehouseId }: FlowContext,
): Promise<FlowResult> {
  const tag = runId.toUpperCase();
  const request = (step: string) => `${runId}-${step}`;
  const buildingCode = `E2E-${tag}-B`.slice(0, 64);
  const buildingName = `CI E2E building ${runId}`;

  const buildingId = written(
    "create building",
    await execute("mutation", "storageLayouts/writes:createStorageBuilding", {
      warehouseId,
      requestId: request("building"),
      code: buildingCode,
      name: buildingName,
      widthMm: 12_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 3_000,
      floorCount: 1,
    }),
  );

  for (const [label, xMm] of [
    ["Z1", 500],
    ["Z2", 6_500],
  ] as const) {
    written(
      `create zone ${label}`,
      await execute("mutation", "storageLayouts/zones:createStorageZone", {
        warehouseId,
        buildingId,
        floorNumber: 1,
        requestId: request(`zone-${label}`),
        label,
        xMm,
        yMm: 500,
        widthMm: 4_000,
        depthMm: 4_000,
        maxStackHeightMm: 3_000,
        mode: "SIMPLE",
      }),
    );
  }

  // Readback: the saved layout returns both zones with server-assigned codes.
  const layout = allowed(
    "read layout",
    await execute(
      "query",
      "storageLayouts/catalogue:getStorageBuildingLayout",
      {
        warehouseId,
        buildingId,
      },
    ),
  ) as {
    found: boolean;
    building: { version: number; code: string; name: string };
    floors: {
      storageZones: { zoneId: string; code: string; label: string }[];
    }[];
  };
  if (!layout.found || layout.building.code !== buildingCode) {
    throw new FlowError("read layout: building did not read back");
  }
  const zones = layout.floors.flatMap((floor) => floor.storageZones);
  const source = zones.find((zone) => zone.label === "Z1");
  const target = zones.find((zone) => zone.label === "Z2");
  if (!source || !target)
    throw new FlowError("read layout: zones did not read back");

  written(
    "activate building",
    await execute("mutation", "storageLayouts/writes:activateStorageBuilding", {
      warehouseId,
      buildingId,
      requestId: request("activate"),
      expectedVersion: layout.building.version,
    }),
  );

  const productSku = `E2E-${tag}`.slice(0, 64);
  const productId = written(
    "save product",
    await execute("mutation", "finishedGoods/workflow:saveProduct", {
      warehouseId,
      requestId: request("product"),
      sku: productSku,
      name: `CI E2E product ${runId}`,
      unit: "pieces",
      storageFormat: "PALLET",
      defaultQuantity: 10,
      storageCondition: "Dry",
      draft: false,
    }),
  );
  const palletId = written(
    "create pallet",
    await execute("mutation", "finishedGoods/workflow:createPallet", {
      warehouseId,
      requestId: request("pallet"),
      productId,
    }),
  );
  const pallet = { warehouseId, palletId };
  written(
    "measure pallet",
    await execute("mutation", "finishedGoods/workflow:saveMeasurement", {
      ...pallet,
      requestId: request("measure"),
      quantity: 10,
      lengthMm: 1_200,
      widthMm: 1_000,
      heightMm: 1_000,
    }),
  );

  const sourcePlacementId = written(
    "reserve placement",
    await execute("mutation", "finishedGoods/workflow:reserve", {
      ...pallet,
      requestId: request("reserve"),
      zoneId: source.zoneId,
      xMm: 0,
      yMm: 0,
      rotation: 0,
    }),
  );
  written(
    "verify destination",
    await execute("mutation", "finishedGoods/workflow:verifyDestination", {
      ...pallet,
      requestId: request("verify"),
      code: source.code,
      method: "MANUAL",
    }),
  );
  written(
    "confirm stored",
    await execute("mutation", "finishedGoods/workflow:confirmStored", {
      ...pallet,
      requestId: request("store"),
      physicalConfirmed: true,
    }),
  );

  const moveId = written(
    "reserve move",
    await execute("mutation", "finishedGoods/workflow:reserveMove", {
      ...pallet,
      requestId: request("move-prepare"),
      zoneId: target.zoneId,
      xMm: 0,
      yMm: 0,
      rotation: 0,
      expectedSourcePlacementId: sourcePlacementId,
    }),
  );
  const acknowledged = {
    ...pallet,
    moveId,
    confirmationMethod: "ACKNOWLEDGEMENT",
    physicalConfirmed: true,
  };
  written(
    "start move",
    await execute("mutation", "finishedGoods/workflow:startMove", {
      ...acknowledged,
      requestId: request("move-start"),
    }),
  );
  written(
    "complete move",
    await execute("mutation", "finishedGoods/workflow:completeMove", {
      ...acknowledged,
      requestId: request("move-complete"),
    }),
  );

  // Readback of the moved pallet.
  const detail = allowed(
    "read pallet",
    await execute("query", "finishedGoods/workflow:getPallet", pallet),
  ) as { placement?: { zoneId?: string; status?: string } } | null;
  if (detail?.placement?.zoneId !== target.zoneId) {
    throw new FlowError(
      "read pallet: pallet is not in the target zone after the move",
    );
  }
  if (detail.placement.status !== "STORED") {
    throw new FlowError("read pallet: moved pallet is not stored");
  }

  return {
    buildingId,
    buildingCode,
    buildingName,
    sourceZoneCode: source.code,
    targetZoneCode: target.code,
    palletId,
    productSku,
  };
}

/**
 * Denials the flow must observe. A tenant-context denial is thrown by the
 * server; an authorization denial is returned as an envelope. Either counts;
 * a written result never does.
 */
export async function expectDenied(
  step: string,
  attempt: () => Promise<unknown>,
): Promise<string> {
  let outcome: unknown;
  try {
    outcome = await attempt();
  } catch (error) {
    const data = (error as { data?: { code?: string } }).data;
    if (typeof data?.code === "string") return data.code;
    throw new FlowError(`${step}: failed without a tenant denial code`);
  }
  if ((outcome as Outcome)?.ok === false) return "AUTHORIZATION_DENIED";
  throw new FlowError(`${step}: was allowed`);
}
