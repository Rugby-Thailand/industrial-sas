/**
 * Customer orders and their lines.
 *
 * Status: **implemented** (Phase 5A).
 *
 * This is the entry point of the order-to-ship flow: a customer asks for boxes,
 * and every line is immediately answered with "we have made this before" or "we
 * have not". That answer is not a suggestion — it decides the line's status, and
 * a `NEW` line raises the design request engineering works from
 * (`INV-0013-01`).
 *
 * ### Why exact reuse uses the customer's identity and not geometry
 *
 * The lookup is indexed on customer + normalized customer product code. The
 * structural `designKeyOf` fingerprint can rank similar designs for a person,
 * but it never auto-pins a revision.
 *
 * ### Why the design request is written in the same transaction as the line
 *
 * An `AWAITING_DESIGN` line with no request is work nobody can see: it is not in
 * engineering's queue and it is not blocking anything visible in sales. Convex
 * mutations are transactional, so the line and its request land together or
 * neither does.
 *
 * ### Why cancellation needs a second pair of eyes
 *
 * `sales.order.cancel` carries `MAKER_CHECKER`. Cancelling a customer order
 * withdraws a commitment the tenant made, and the person who entered it is the
 * person most likely to withdraw it by accident. The maker is read from the
 * order's own audit trail rather than an argument, so the fact cannot be
 * supplied by the caller (`INV-0006-05`).
 */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  CODE_FIELD,
  appendDomainAudit,
  assertUnique,
  createMasterDataRow,
  insertedFields,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
  type UniquenessCheck,
} from "../lib/masterDataStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageResult,
  pageRequestOf,
} from "../lib/listEnvelope";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import type { TenantDocumentAccess, TenantOrgId } from "../lib/tenantDb";
import {
  boxSpecification,
  customerOrderLineStatus,
  customerOrderStatus,
  designRequestPriority,
  designSource,
} from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  checkLineAddition,
  checkLineCancellation,
  checkOrderCancellation,
  checkOrderRelease,
  checkOrderedQuantity,
  initialLineStatus,
  type CustomerOrderLineState,
} from "../model/orderToShip/customerOrder";
import {
  decideDesignSource,
  designKeyOf,
  makeDesignSpecification,
  normalizeCustomerProductCode,
} from "../model/orderToShip/designSpecification";

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

export const SALES_ORDER_OPERATIONS = Object.freeze({
  createOrder: "sales.order.create",
  addLine: "sales.order.line.add",
  releaseOrder: "sales.order.release",
  cancelOrder: "sales.order.cancel",
  cancelLine: "sales.order.line.cancel",
});

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

type OrderDocument = Doc<"customerOrders">;
type OrderLineDocument = Doc<"customerOrderLines">;
type MasterCardDocument = Doc<"masterCards">;
type RevisionDocument = Doc<"masterCardRevisions">;

/* -------------------------------------------------------------------------- */
/* Uniqueness                                                                  */
/* -------------------------------------------------------------------------- */

/** `(orgId, orderNumber)`: an order number is unique per organization. */
const orderUniqueness = (orderNumber: string): readonly UniquenessCheck[] => [
  {
    field: "orderNumber",
    index: "by_orgId_orderNumber",
    equality: [{ field: "orderNumber", value: orderNumber }],
  },
];

/**
 * `(orgId, customerOrderId, lineNumber)`: line positions do not repeat.
 *
 * Without it, two operators adding "line 10" concurrently would both succeed and
 * the order would have two line tens — which the print-out, the packet, and the
 * customer's own numbering all disagree about.
 */
const lineUniqueness = (
  customerOrderId: string,
  lineNumber: number,
): readonly UniquenessCheck[] => [
  {
    field: "lineNumber",
    index: "by_orgId_customerOrderId_lineNumber",
    equality: [
      { field: "customerOrderId", value: customerOrderId },
      { field: "lineNumber", value: lineNumber },
    ],
  },
];

/** The longest customer purchase-order reference this repository will store. */
export const MAX_CUSTOMER_REFERENCE = 64;

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Open a draft customer order.
 *
 * `customerReference` is the customer's own PO number, stored as given after a
 * length check rather than normalized as a code: it is somebody else's
 * identifier, and upper-casing or stripping it would make the value the tenant
 * quotes back differ from the one on the customer's document.
 */
export const createCustomerOrder = mutationWithOrg({
  args: {
    requestId: v.string(),
    orderNumber: v.string(),
    customerId: v.id("customers"),
    customerReference: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "sales.order.create",
  target: { table: "customerOrders" },
  handler: async (ctx, args) => {
    const orderNumber = normalizeField(
      "orderNumber",
      args.orderNumber,
      CODE_FIELD,
    );
    if (!orderNumber.ok) return refusal(orderNumber.error);

    let customerReference: string | undefined;
    if (args.customerReference !== undefined) {
      const trimmed = args.customerReference.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_CUSTOMER_REFERENCE) {
        return refusal({
          code: "FIELD_INVALID",
          field: "customerReference",
          reason: trimmed.length === 0 ? "EMPTY" : "TOO_LONG",
        });
      }
      customerReference = trimmed;
    }

    const customer = await ctx.tenantDb.get("customers", args.customerId);
    if (customer === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "customerId" });
    }

    const context = writeContextOf(ctx, {
      table: "customerOrders",
      operation: SALES_ORDER_OPERATIONS.createOrder,
      requestId: args.requestId,
    });

    const outcome = await createMasterDataRow({
      ...context,
      fingerprint: {
        operation: SALES_ORDER_OPERATIONS.createOrder,
        requestId: args.requestId,
        orderNumber: orderNumber.value,
        customerId: args.customerId,
        ...(customerReference === undefined ? {} : { customerReference }),
      },
      uniqueness: [
        ...orderUniqueness(orderNumber.value),
        /*
         * `(customerId, customerReference)` is unique only when the reference is
         * present: many orders legitimately have none, and a contract that
         * counted absences would let the first order without a customer PO block
         * every later one.
         */
        ...(customerReference === undefined
          ? []
          : [
              {
                field: "customerReference",
                index: "by_orgId_customerId_customerReference",
                equality: [
                  { field: "customerId", value: args.customerId },
                  { field: "customerReference", value: customerReference },
                ],
              },
            ]),
      ],
      document: {
        orderNumber: orderNumber.value,
        customerId: args.customerId,
        ...(customerReference === undefined ? {} : { customerReference }),
        status: "DRAFT",
        /*
         * The server's clock, never the caller's: a client-supplied instant
         * would let a browser backdate a commitment, and this is the field the
         * order list sorts a customer's history by.
         */
        orderedAt: context.now,
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Add a line to a draft order, answering the exact-match question as it goes.
 *
 * The design decision is computed here and written onto the line, rather than
 * left for a later screen to derive: a line's status *is* the decision
 * (`initialLineStatus`), and a status derived at read time would change under a
 * later release without anything recording that it had.
 */
export const addCustomerOrderLine = mutationWithOrg({
  args: {
    requestId: v.string(),
    customerOrderId: v.id("customerOrders"),
    lineNumber: v.number(),
    customerProductCode: v.string(),
    specification: boxSpecification,
    orderedQuantity: v.number(),
    designPriority: v.optional(designRequestPriority),
    designDueAt: v.optional(v.number()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "sales.order.update",
  target: {
    table: "customerOrders",
    id: ({ customerOrderId }) => customerOrderId,
  },
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<OrderDocument>(
      "customerOrders",
      args.customerOrderId,
    );
    if (order === null) {
      return refusal({ code: "NOT_FOUND", table: "customerOrders" });
    }

    if (!Number.isInteger(args.lineNumber) || args.lineNumber <= 0) {
      return refusal({
        code: "FIELD_INVALID",
        field: "lineNumber",
        reason: "NOT_A_POSITIVE_WHOLE_NUMBER",
      });
    }

    const specification = makeDesignSpecification(args.specification);
    if (!specification.ok) return refusal(specification.error);
    const customerProductCode = normalizeCustomerProductCode(
      args.customerProductCode,
    );
    if (!customerProductCode.ok) return refusal(customerProductCode.error);

    const quantity = checkOrderedQuantity(args.orderedQuantity);
    if (!quantity.ok) return refusal(quantity.error);

    const fingerprint = {
      operation: SALES_ORDER_OPERATIONS.addLine,
      requestId: args.requestId,
      customerOrderId: args.customerOrderId,
      lineNumber: args.lineNumber,
      customerProductCode: customerProductCode.value,
      specification: specification.value,
      orderedQuantity: quantity.value,
      designPriority: args.designPriority ?? "NORMAL",
      designDueAt: args.designDueAt,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "customerOrderLines",
      operation: SALES_ORDER_OPERATIONS.addLine,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const addition = checkLineAddition(order);
    if (!addition.ok) return refusal(addition.error);

    /*
     * The exact-match lookup: one indexed read on customer + customer product code,
     * then one get of the card's released revision. `first()` rather than
     * `unique()` because a second row under a contract-unique key is a
     * pre-existing corruption whose surfacing is `schemaPolicy`'s job, not this
     * write's — this write's job either way is to answer the question.
     */
    const designKey = designKeyOf(specification.value);
    const card = await ctx.tenantDb
      .byIndex<MasterCardDocument>(
        "masterCards",
        "by_orgId_customerId_customerProductCode",
        [
          { field: "customerId", value: order.customerId },
          {
            field: "customerProductCode",
            value: customerProductCode.value,
          },
        ],
      )
      .first();

    const released =
      card?.status !== "ACTIVE" || card.releasedRevisionId === undefined
        ? null
        : await ctx.tenantDb.get<RevisionDocument>(
            "masterCardRevisions",
            card.releasedRevisionId,
          );

    const decision = decideDesignSource({
      customerProductCode: customerProductCode.value,
      specification: specification.value,
      ...(released === null
        ? {}
        : {
            releasedCandidate: {
              revisionId: released._id,
              status: released.status,
              customerProductCode: card!.customerProductCode,
            },
          }),
    });
    if (!decision.ok) return refusal(decision.error);

    const context = writeContextOf(ctx, {
      table: "customerOrderLines",
      operation: SALES_ORDER_OPERATIONS.addLine,
      requestId: args.requestId,
    });

    const outcome = await createMasterDataRow({
      ...context,
      fingerprint,
      uniqueness: lineUniqueness(args.customerOrderId, args.lineNumber),
      document: {
        customerOrderId: args.customerOrderId,
        lineNumber: args.lineNumber,
        customerProductCode: customerProductCode.value,
        specification: { ...specification.value },
        designKey,
        designSource: decision.value.source,
        status: initialLineStatus(decision.value),
        orderedQuantity: quantity.value,
        ...(decision.value.masterCardRevisionId === undefined
          ? {}
          : { masterCardRevisionId: decision.value.masterCardRevisionId }),
      },
    });

    if (!outcome.ok) return refusal(outcome.error);

    /*
     * A `NEW` line owes engineering a drawing, and the row that says so is
     * written here — in the same transaction — because an `AWAITING_DESIGN` line
     * with no request is work that appears in nobody's queue. A replay writes
     * nothing: the request already exists from the original attempt.
     */
    if (!outcome.value.replayed && decision.value.source === "NEW") {
      const requestNumber = `${order.orderNumber}-${args.lineNumber}`;
      const free = await assertUnique(ctx.tenantDb, "designRequests", [
        {
          field: "requestNumber",
          index: "by_orgId_requestNumber",
          equality: [{ field: "requestNumber", value: requestNumber }],
        },
        {
          field: "customerOrderLineId",
          index: "by_orgId_customerOrderLineId",
          equality: [
            { field: "customerOrderLineId", value: outcome.value.documentId },
          ],
        },
      ]);
      if (!free.ok) return refusal(free.error);

      const document = {
        requestNumber,
        customerOrderLineId: outcome.value.documentId,
        status: "OPEN",
        priority: args.designPriority ?? "NORMAL",
        latestRequirementVersion: 0,
        requirementReadiness: "INCOMPLETE",
        missingRequirements: [
          "CUSTOMER_PRODUCT_IDENTITY",
          "DIMENSIONS",
          "CONSTRUCTION",
          "PRINT",
          "PACKING",
          "ROUTE",
          "MATERIALS",
          "QUALITY",
        ],
        ...(args.designDueAt === undefined ? {} : { dueAt: args.designDueAt }),
      };
      const designRequestId = await ctx.tenantDb.insert(
        "designRequests",
        document,
      );
      await appendDomainAudit(context, {
        entityTable: "designRequests",
        entityId: designRequestId,
        changes: insertedFields(document),
      });
    }

    return written(outcome.value);
  },
});

/**
 * Release an order: the tenant commits to it.
 *
 * Release does **not** wait for design. Engineering may still be drawing, and
 * telling a customer "not accepted yet" for work the tenant has in fact accepted
 * would be a lie the system told on the tenant's behalf. What release unlocks is
 * the *next* step — `production.packet.issue` refuses a line with no released
 * revision pinned to it.
 */
export const releaseCustomerOrder = mutationWithOrg({
  args: {
    requestId: v.string(),
    customerOrderId: v.id("customerOrders"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "sales.order.release",
  target: {
    table: "customerOrders",
    id: ({ customerOrderId }) => customerOrderId,
  },
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<OrderDocument>(
      "customerOrders",
      args.customerOrderId,
    );
    if (order === null) {
      return refusal({ code: "NOT_FOUND", table: "customerOrders" });
    }

    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "customerOrders",
      operation: SALES_ORDER_OPERATIONS.releaseOrder,
      requestId: args.requestId,
      fingerprint: {
        operation: SALES_ORDER_OPERATIONS.releaseOrder,
        requestId: args.requestId,
        customerOrderId: args.customerOrderId,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const live = await liveLinesOf(ctx.tenantDb, args.customerOrderId);
    const release = checkOrderRelease(order, live);
    if (!release.ok) return refusal(release.error);

    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "customerOrders",
        operation: SALES_ORDER_OPERATIONS.releaseOrder,
        requestId: args.requestId,
      }),
      documentId: args.customerOrderId,
      fingerprint: {
        operation: SALES_ORDER_OPERATIONS.releaseOrder,
        requestId: args.requestId,
        customerOrderId: args.customerOrderId,
      },
      uniqueness: [],
      patch: { status: release.value },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Cancel an order, with a second pair of eyes.
 *
 * Refused outright once any line has been handed to a factory: a packet on a
 * shop floor is a physical fact, and cancelling the order out from under it
 * would leave people building against a commitment the system says no longer
 * exists. The packet is the thing to cancel first, and the refusal names the
 * field to look at.
 */
export const cancelCustomerOrder = mutationWithOrg({
  args: {
    requestId: v.string(),
    customerOrderId: v.id("customerOrders"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "sales.order.cancel",
  target: {
    table: "customerOrders",
    id: ({ customerOrderId }) => customerOrderId,
  },
  policy: orderMakerPolicy,
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<OrderDocument>(
      "customerOrders",
      args.customerOrderId,
    );
    if (order === null) {
      return refusal({ code: "NOT_FOUND", table: "customerOrders" });
    }

    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "customerOrders",
      operation: SALES_ORDER_OPERATIONS.cancelOrder,
      requestId: args.requestId,
      fingerprint: {
        operation: SALES_ORDER_OPERATIONS.cancelOrder,
        requestId: args.requestId,
        customerOrderId: args.customerOrderId,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const handedOff = await ctx.tenantDb
      .byIndex<OrderLineDocument>(
        "customerOrderLines",
        "by_orgId_customerOrderId_status",
        [
          { field: "customerOrderId", value: args.customerOrderId },
          { field: "status", value: "HANDED_OFF" },
        ],
      )
      .first();

    const probe: readonly CustomerOrderLineState[] =
      handedOff === null ? [] : [{ status: "HANDED_OFF" }];
    const cancellation = checkOrderCancellation(order, probe);
    if (!cancellation.ok) return refusal(cancellation.error);

    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "customerOrders",
        operation: SALES_ORDER_OPERATIONS.cancelOrder,
        requestId: args.requestId,
      }),
      documentId: args.customerOrderId,
      fingerprint: {
        operation: SALES_ORDER_OPERATIONS.cancelOrder,
        requestId: args.requestId,
        customerOrderId: args.customerOrderId,
      },
      uniqueness: [],
      patch: { status: cancellation.value },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/** Cancel one line, leaving the rest of the order alone. */
export const cancelCustomerOrderLine = mutationWithOrg({
  args: {
    requestId: v.string(),
    customerOrderLineId: v.id("customerOrderLines"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "sales.order.update",
  target: {
    table: "customerOrderLines",
    id: ({ customerOrderLineId }) => customerOrderLineId,
  },
  handler: async (ctx, args) => {
    const line = await ctx.tenantDb.get<OrderLineDocument>(
      "customerOrderLines",
      args.customerOrderLineId,
    );
    if (line === null) {
      return refusal({ code: "NOT_FOUND", table: "customerOrderLines" });
    }

    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "customerOrderLines",
      operation: SALES_ORDER_OPERATIONS.cancelLine,
      requestId: args.requestId,
      fingerprint: {
        operation: SALES_ORDER_OPERATIONS.cancelLine,
        requestId: args.requestId,
        customerOrderLineId: args.customerOrderLineId,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const cancellation = checkLineCancellation(line);
    if (!cancellation.ok) return refusal(cancellation.error);

    const context = writeContextOf(ctx, {
      table: "customerOrderLines",
      operation: SALES_ORDER_OPERATIONS.cancelLine,
      requestId: args.requestId,
    });

    const outcome = await updateMasterDataRow({
      ...context,
      documentId: args.customerOrderLineId,
      fingerprint: {
        operation: SALES_ORDER_OPERATIONS.cancelLine,
        requestId: args.requestId,
        customerOrderLineId: args.customerOrderLineId,
      },
      uniqueness: [],
      patch: { status: cancellation.value },
    });

    if (!outcome.ok) return refusal(outcome.error);

    /*
     * A cancelled line's outstanding design request is closed with it. Leaving
     * it open would keep a drawing in engineering's queue for a line nobody is
     * going to make, and an engineer who drew it would find nothing to pin it
     * to.
     */
    if (!outcome.value.replayed) {
      const request = await ctx.tenantDb
        .byIndex<{
          readonly _id: string;
          readonly orgId: TenantOrgId;
          readonly status: string;
        }>("designRequests", "by_orgId_customerOrderLineId", [
          { field: "customerOrderLineId", value: args.customerOrderLineId },
        ])
        .first();

      if (
        request !== null &&
        (request.status === "OPEN" || request.status === "ASSIGNED")
      ) {
        await ctx.tenantDb.patch("designRequests", request._id, {
          status: "CANCELLED",
        });
        await appendDomainAudit(context, {
          entityTable: "designRequests",
          entityId: request._id,
          changes: [{ field: "status", from: request.status, to: "CANCELLED" }],
        });
      }
    }

    return written(outcome.value);
  },
});

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Who entered this order, read from the order's own audit trail.
 *
 * Read from the trail rather than taken as an argument, for the reason every
 * maker-checker fact is: a caller who can name the maker can name themselves
 * somebody else. The evaluator denies when the maker and the actor are the same
 * person (`INV-0006-05`), so cancelling your own order is refused — which is the
 * intended reading of separation of duties on a commitment to a customer.
 *
 * An order with no readable creation audit yields `approvalSatisfied: false`,
 * which denies. Fail-closed is the only safe direction: "we cannot tell who
 * made this" is not "anybody may cancel it".
 */
async function orderMakerPolicy(
  ctx: TenantPolicyContext,
  args: { readonly customerOrderId: string },
): Promise<{
  readonly thresholdExceeded: boolean;
  readonly approvalSatisfied: boolean;
  readonly makerUserId?: string;
}> {
  const audit = await ctx.tenantDb
    .byIndex<{
      readonly orgId: TenantOrgId;
      readonly actorUserId?: string;
    }>("auditEvents", "by_orgId_entityTable_entityId_occurredAt", [
      { field: "entityTable", value: "customerOrders" },
      { field: "entityId", value: args.customerOrderId },
    ])
    .first();

  if (audit === null || audit.actorUserId === undefined) {
    return Object.freeze({
      thresholdExceeded: false,
      approvalSatisfied: false,
    });
  }
  return Object.freeze({
    thresholdExceeded: false,
    approvalSatisfied: true,
    makerUserId: audit.actorUserId,
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One representative live line per non-cancelled status, for the release check.
 *
 * `checkOrderRelease` needs to know whether *any* live line exists, not how
 * many. Three `first()` reads on `by_orgId_customerOrderId_status` answer that
 * exactly, where paging the order's lines to look for one would read a
 * thousand-line order to learn a single boolean — and would still be wrong for
 * an order longer than a page.
 */
const LIVE_LINE_STATUSES = Object.freeze([
  "AWAITING_DESIGN",
  "DESIGN_READY",
  "HANDED_OFF",
] as const);

async function liveLinesOf(
  tenantDb: TenantDocumentAccess,
  customerOrderId: string,
): Promise<readonly CustomerOrderLineState[]> {
  const found: CustomerOrderLineState[] = [];
  for (const status of LIVE_LINE_STATUSES) {
    const line = await tenantDb
      .byIndex<OrderLineDocument>(
        "customerOrderLines",
        "by_orgId_customerOrderId_status",
        [
          { field: "customerOrderId", value: customerOrderId },
          { field: "status", value: status },
        ],
      )
      .first();
    if (line !== null) found.push({ status });
  }
  return Object.freeze(found);
}

const orderValidator = v.object({
  customerOrderId: v.id("customerOrders"),
  orderNumber: v.string(),
  customerId: v.id("customers"),
  customerReference: v.optional(v.string()),
  status: customerOrderStatus,
  orderedAt: v.number(),
});

const orderLineValidator = v.object({
  customerOrderLineId: v.id("customerOrderLines"),
  customerOrderId: v.id("customerOrders"),
  lineNumber: v.number(),
  customerProductCode: v.string(),
  specification: boxSpecification,
  designKey: v.string(),
  designSource,
  status: customerOrderLineStatus,
  orderedQuantity: v.number(),
  masterCardRevisionId: v.optional(v.id("masterCardRevisions")),
});

/** Orders, in order-number order, optionally narrowed to one status. */
export const listCustomerOrders = queryWithOrg({
  args: { status: v.optional(customerOrderStatus), ...listArgs },
  returns: pageOf(orderValidator),
  permissionCode: "sales.order.read",
  target: { table: "customerOrders" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const page = await ctx.tenantDb
      .byIndex<OrderDocument>(
        "customerOrders",
        args.status === undefined
          ? "by_orgId_orderNumber"
          : "by_orgId_status_orderNumber",
        args.status === undefined
          ? []
          : [{ field: "status", value: args.status }],
      )
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((order) => ({
        customerOrderId: order._id as never,
        orderNumber: order.orderNumber,
        customerId: order.customerId as never,
        ...(order.customerReference === undefined
          ? {}
          : { customerReference: order.customerReference }),
        status: order.status as never,
        orderedAt: order.orderedAt,
      })),
      page,
    );
  },
});

/** The lines of one order, in position order. */
export const listCustomerOrderLines = queryWithOrg({
  args: {
    customerOrderId: v.id("customerOrders"),
    status: v.optional(customerOrderLineStatus),
    ...listArgs,
  },
  returns: pageOf(orderLineValidator),
  permissionCode: "sales.order.read",
  target: {
    table: "customerOrders",
    id: ({ customerOrderId }) => customerOrderId,
  },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    /*
     * The order is read first, through the tenant-bound accessor, so another
     * tenant's order ID answers the same "no such order" a nonexistent one does
     * (`INV-0002-03`) rather than an empty page that would confirm the ID
     * parses.
     */
    const order = await ctx.tenantDb.get(
      "customerOrders",
      args.customerOrderId,
    );
    if (order === null) return pageRefusal("REFERENCE_NOT_FOUND");

    const page = await ctx.tenantDb
      .byIndex<OrderLineDocument>(
        "customerOrderLines",
        args.status === undefined
          ? "by_orgId_customerOrderId_lineNumber"
          : "by_orgId_customerOrderId_status",
        [
          { field: "customerOrderId", value: args.customerOrderId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((line) => ({
        customerOrderLineId: line._id as never,
        customerOrderId: line.customerOrderId as never,
        lineNumber: line.lineNumber,
        customerProductCode: line.customerProductCode,
        specification: { ...line.specification },
        designKey: line.designKey,
        designSource: line.designSource as never,
        status: line.status as never,
        orderedQuantity: line.orderedQuantity,
        ...(line.masterCardRevisionId === undefined
          ? {}
          : { masterCardRevisionId: line.masterCardRevisionId as never }),
      })),
      page,
    );
  },
});

/**
 * Design-ready lines that do not yet have fulfillment demand. This is the
 * bounded handoff queue used by routing; it keeps operators from copying opaque
 * document IDs between Sales and Fulfillment.
 */
export const listRoutableCustomerOrderLines = queryWithOrg({
  args: { ...listArgs },
  returns: pageOf(orderLineValidator),
  permissionCode: "sales.order.read",
  target: { table: "customerOrderLines" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<OrderLineDocument>(
        "customerOrderLines",
        "by_orgId_status_designKey",
        [{ field: "status", value: "DESIGN_READY" }],
      )
      .page(pageOptions(request.value));
    const unrouted: OrderLineDocument[] = [];
    for (const line of page.page) {
      const routed = await ctx.tenantDb
        .byIndex("fulfillmentLines", "by_orgId_customerOrderLineId", [
          { field: "customerOrderLineId", value: line._id },
        ])
        .first();
      if (routed === null) unrouted.push(line);
    }
    return pageResult(
      unrouted.map((line) => ({
        customerOrderLineId: line._id as never,
        customerOrderId: line.customerOrderId as never,
        lineNumber: line.lineNumber,
        customerProductCode: line.customerProductCode,
        specification: { ...line.specification },
        designKey: line.designKey,
        designSource: line.designSource as never,
        status: line.status as never,
        orderedQuantity: line.orderedQuantity,
        ...(line.masterCardRevisionId === undefined
          ? {}
          : { masterCardRevisionId: line.masterCardRevisionId as never }),
      })),
      page,
    );
  },
});
