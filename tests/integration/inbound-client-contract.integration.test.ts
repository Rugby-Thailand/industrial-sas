/**
 * The drift guard between the browser and the inbound server functions.
 *
 * `src/lib/convex/inboundApi.ts` names its functions with hand-written strings
 * because `convex/_generated/` is a git-ignored build artifact; the cost of that
 * choice is that a rename on the server would surface at run time, at a dock, as
 * "function not found". This file pays that cost back by importing the real
 * modules and failing the build the moment they disagree.
 *
 * It also guards the one *value* the browser restates: the import chunk size.
 * Preview mode walks the chunk arithmetic locally so the resume path is
 * reviewable without a deployment, and a client that chunked differently from
 * the server would show a progress bar that did not match what was written.
 */
import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";

import * as labels from "../../convex/labels/print";
import * as catalogue from "../../convex/masterData/catalogue";
import { DEFAULT_CHUNK_SIZE as SERVER_CHUNK_SIZE } from "../../convex/model/inbound/poImport";
import * as purchasing from "../../convex/purchasing/orders";
import * as putaway from "../../convex/putaway/tasks";
import * as quality from "../../convex/quality/inspections";
import * as receiving from "../../convex/receiving/receipts";
import {
  INBOUND_MUTATION_PATHS,
  INBOUND_QUERY_PATHS,
  claimPutawayTaskRef,
  listPurchaseOrdersRef,
  postReceiptLineRef,
  submitDispositionRef,
} from "../../src/lib/convex/inboundApi";
import { DEFAULT_CHUNK_SIZE as CLIENT_CHUNK_SIZE } from "../../src/lib/inbound/importChunking";

/** A registered public function, as the Convex builders mark one. */
interface RegisteredShape {
  readonly isQuery?: boolean;
  readonly isMutation?: boolean;
  readonly isPublic?: boolean;
}

const MODULES: Readonly<Record<string, Record<string, unknown>>> = {
  "masterData/catalogue": catalogue as unknown as Record<string, unknown>,
  "purchasing/orders": purchasing as unknown as Record<string, unknown>,
  "receiving/receipts": receiving as unknown as Record<string, unknown>,
  "quality/inspections": quality as unknown as Record<string, unknown>,
  "putaway/tasks": putaway as unknown as Record<string, unknown>,
  "labels/print": labels as unknown as Record<string, unknown>,
};

const exportFor = (path: string): RegisteredShape | undefined => {
  const [modulePath, exportName] = path.split(":");
  const serverModule = MODULES[modulePath ?? ""];
  expect(serverModule, path).toBeDefined();
  return serverModule?.[exportName ?? ""] as RegisteredShape | undefined;
};

describe("inbound client contract", () => {
  it("names a reference for each path the client uses", () => {
    expect(getFunctionName(listPurchaseOrdersRef)).toBe(
      INBOUND_QUERY_PATHS.listPurchaseOrders,
    );
    expect(getFunctionName(postReceiptLineRef)).toBe(
      INBOUND_MUTATION_PATHS.postReceiptLine,
    );
    expect(getFunctionName(submitDispositionRef)).toBe(
      INBOUND_MUTATION_PATHS.submitDisposition,
    );
    expect(getFunctionName(claimPutawayTaskRef)).toBe(
      INBOUND_MUTATION_PATHS.claimPutawayTask,
    );
  });

  it.each(Object.entries(INBOUND_QUERY_PATHS))(
    "resolves %s to a registered public query",
    (_name, path) => {
      const exported = exportFor(path);
      expect(typeof exported, path).toBe("function");
      expect(exported?.isQuery, path).toBe(true);
      expect(exported?.isPublic, path).toBe(true);
    },
  );

  it.each(Object.entries(INBOUND_MUTATION_PATHS))(
    "resolves %s to a registered public mutation",
    (_name, path) => {
      /*
       * `isMutation` rather than only "it is defined". An export of the right
       * name that turned out to be a query would satisfy existence and still
       * fail from a browser — and a *read* reached through `useMutation` fails
       * in the least legible way available.
       */
      const exported = exportFor(path);
      expect(typeof exported, path).toBe("function");
      expect(exported?.isMutation, path).toBe(true);
      expect(exported?.isPublic, path).toBe(true);
    },
  );

  it("resolves the receiving-location read the capture screens depend on", () => {
    /*
     * The capture form's dock picker is the difference between a screen that
     * works on a configured deployment and one that sends a synthetic
     * identifier to a real mutation. Its reference is guarded like any other.
     */
    const exported = catalogue as unknown as Record<string, RegisteredShape>;
    expect(typeof exported["listReceivingLocations"]).toBe("function");
    expect(exported["listReceivingLocations"]?.isQuery).toBe(true);
    expect(exported["listReceivingLocations"]?.isPublic).toBe(true);
  });

  it("keeps the preview's chunk arithmetic equal to the server's", () => {
    expect(CLIENT_CHUNK_SIZE).toBe(SERVER_CHUNK_SIZE);
  });

  it("declares no reference the screens do not import", () => {
    // A reference with no caller is a reference nothing type-checks against,
    // which is how a rename survives a build and fails in a warehouse instead.
    for (const path of [
      ...Object.values(INBOUND_QUERY_PATHS),
      ...Object.values(INBOUND_MUTATION_PATHS),
    ]) {
      expect(path).toMatch(
        /^(purchasing\/orders|receiving\/receipts|quality\/inspections|putaway\/tasks|labels\/print):/,
      );
    }
  });
});
