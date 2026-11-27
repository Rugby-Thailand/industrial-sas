import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import type { JobTicketFields } from "../../../convex/model/finishedGoods/jobScans";
import { expectTypeOf, it } from "vitest";

import type { RefValue } from "./clientRef";
import type { fgRefs } from "./finishedGoodsApi";

it("infers exact job-scan result contracts at the client boundary", () => {
  type WriteResult =
    | {
        readonly written: true;
        readonly documentId: string;
        readonly replayed: boolean;
      }
    | {
        readonly written: false;
        readonly error: {
          readonly code: string;
          readonly field?: string;
          readonly reason?: string;
          readonly table?: string;
          readonly status?: string;
          readonly requestId?: string;
          readonly affectedLpns?: readonly string[];
        };
      };
  expectTypeOf<
    RefValue<typeof fgRefs.saveJobScans>
  >().toEqualTypeOf<WriteResult>();
  expectTypeOf<
    RefValue<typeof fgRefs.updateJobScan>
  >().toEqualTypeOf<WriteResult>();
  expectTypeOf<RefValue<typeof fgRefs.extractJobTicket>>().toEqualTypeOf<
    | {
        readonly ok: true;
        readonly mock: true;
        readonly fields: Readonly<Partial<JobTicketFields>>;
        readonly raw: string;
      }
    | {
        readonly ok: true;
        readonly mock: false;
        readonly aiUsageOperationId: string;
        readonly fields: Readonly<Partial<JobTicketFields>>;
        readonly raw: string;
      }
    | {
        readonly ok: false;
        readonly error: {
          readonly code:
            "IMAGE_URL_INVALID" | "AI_UNAVAILABLE" | "AI_UNREADABLE";
        };
      }
    | {
        readonly ok: false;
        readonly error: { readonly code: "RATE_LIMITED" };
        readonly retryAfterMs: number;
      }
  >();
  expectTypeOf<RefValue<typeof fgRefs.readJobTicketForSearch>>().toEqualTypeOf<
    | {
        readonly ok: true;
        readonly candidates: {
          readonly factoryOrder?: string;
          readonly productBarcodeText?: string;
        };
      }
    | {
        readonly ok: false;
        readonly error: {
          readonly code:
            | "IMAGE_URL_INVALID"
            | "AI_UNAVAILABLE"
            | "AI_TIMEOUT"
            | "AI_UNREADABLE";
        };
      }
    | {
        readonly ok: false;
        readonly error: { readonly code: "RATE_LIMITED" };
        readonly retryAfterMs: number;
      }
  >();
  type PhotoSearchOutcome = FunctionReturnType<
    typeof fgRefs.readJobTicketForSearch
  >;
  expectTypeOf<Extract<PhotoSearchOutcome, { ok: false }>>().toEqualTypeOf<{
    readonly ok: false;
    readonly requestId: string;
    readonly denial: {
      readonly kind: "AUTHORIZATION_DENIED";
      readonly code: "AUTHORIZATION_DENIED";
      readonly requestId: string;
      readonly message: string;
    };
  }>();
  type Outcome = FunctionReturnType<typeof fgRefs.updateJobScan>;
  expectTypeOf<Extract<Outcome, { ok: false }>>().toEqualTypeOf<{
    readonly ok: false;
    readonly requestId: string;
    readonly denial: {
      readonly kind: "AUTHORIZATION_DENIED";
      readonly code: "AUTHORIZATION_DENIED";
      readonly requestId: string;
      readonly message: string;
    };
  }>();
});

it("retains branded job-scan inputs while accepting raw scanner and route text", () => {
  type Update = FunctionArgs<typeof fgRefs.updateJobScan>;
  type Save = FunctionArgs<typeof fgRefs.saveJobScans>;
  type Extract = FunctionArgs<typeof fgRefs.extractJobTicket>;
  type PhotoSearch = FunctionArgs<typeof fgRefs.readJobTicketForSearch>;
  type List = FunctionArgs<typeof fgRefs.listJobScans>;
  expectTypeOf<string>().toExtend<Update["jobScanId"]>();
  expectTypeOf<Id<"finishedGoodsJobScans">>().toExtend<Update["jobScanId"]>();
  expectTypeOf<Id<"warehouses">>().not.toExtend<Update["jobScanId"]>();
  expectTypeOf<Id<"locations">>().not.toExtend<Save["warehouseId"]>();
  expectTypeOf<Id<"locations">>().not.toExtend<Extract["warehouseId"]>();
  expectTypeOf<Id<"locations">>().not.toExtend<PhotoSearch["warehouseId"]>();
  expectTypeOf<Id<"warehouses">>().toExtend<PhotoSearch["warehouseId"]>();
  expectTypeOf<string>().toExtend<PhotoSearch["warehouseId"]>();
  expectTypeOf<PhotoSearch["imageDataUrl"]>().toEqualTypeOf<string>();
  expectTypeOf<{
    readonly warehouseId: string;
    readonly filter: "ALL";
    readonly search: string;
    readonly searchField: "factoryOrder" | "productBarcodeText";
    readonly exactCode: true;
  }>().toExtend<List>();
});
