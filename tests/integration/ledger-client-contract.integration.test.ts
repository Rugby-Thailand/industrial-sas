import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";

import * as ledger from "../../convex/inventory/ledger";
import * as masterData from "../../convex/masterData/catalogue";
import * as masterDataWrites from "../../convex/masterData/writes";
import { MAX_JOB_PAGE_SIZE } from "../../convex/model/inventory/jobPage";
import {
  DEFAULT_LEDGER_PAGE_SIZE,
  LEDGER_FUNCTION_PATHS,
  listBalancesRef,
  listTransactionsRef,
  MAX_LEDGER_PAGE_SIZE,
} from "../../src/lib/convex/ledgerApi";
import {
  ENTITY_FUNCTION_PATHS,
  MASTER_DATA_FUNCTION_PATHS,
  WRITE_FUNCTION_PATHS,
  createSupplierRef,
  getItemRef,
  listItemsRef,
  listLocationsRef,
  listReasonCodesRef,
  listSuppliersRef,
  publishLabelTemplateRef,
} from "../../src/lib/convex/masterDataApi";

/**
 * The drift guard between the browser and the server.
 *
 * `src/lib/convex/ledgerApi.ts` names its functions with hand-written strings
 * and restates the server's page-size cap, because `convex/_generated/` is a
 * git-ignored build artifact and importing it would break `pnpm typecheck` on
 * any machine that has never run `convex dev`. The cost of that choice is that
 * a rename on the server would be caught at run time, in a warehouse, as
 * "function not found".
 *
 * This file is what pays that cost back. It imports the real module and the
 * real constants and fails the build the moment they disagree with the client's
 * copy.
 */

/**
 * A registered public query, as `queryGeneric` marks one.
 *
 * The markers are asserted rather than only the export's existence: an export
 * of the right name that is a helper, an internal function, or a mutation would
 * satisfy "it is defined" and still fail at run time from a browser.
 */
interface RegisteredQueryShape {
  readonly isQuery?: boolean;
  readonly isPublic?: boolean;
  readonly exportArgs?: unknown;
}

const exportedAt = (path: string): unknown => {
  const [modulePath, exportName] = path.split(":");
  expect(modulePath, path).toBe("inventory/ledger");
  return (ledger as Record<string, unknown>)[exportName ?? ""];
};

/** Every `.tsx` under the feature layer, concatenated. */
function readFeatureSources(): string {
  const root = join(process.cwd(), "src", "features");
  const files: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx")) files.push(path);
    }
  };

  walk(root);
  return files.map((path) => readFileSync(path, "utf8")).join("\n");
}

describe("ledger client contract", () => {
  it("names a function reference for each path the client uses", () => {
    expect(getFunctionName(listBalancesRef)).toBe(
      LEDGER_FUNCTION_PATHS.listBalances,
    );
    expect(getFunctionName(listTransactionsRef)).toBe(
      LEDGER_FUNCTION_PATHS.listTransactions,
    );
  });

  it.each(Object.entries(LEDGER_FUNCTION_PATHS))(
    "resolves %s to a registered public query on the server",
    (_name, path) => {
      const exported = exportedAt(path) as RegisteredQueryShape | undefined;

      expect(typeof exported, path).toBe("function");
      expect(exported?.isQuery, path).toBe(true);
      expect(exported?.isPublic, path).toBe(true);
      expect(typeof exported?.exportArgs, path).toBe("function");
    },
  );

  it("does not reference a write function", () => {
    // The read screens exist; the write flows do not. A reference declared
    // ahead of its UI is a reference nothing type-checks against a caller.
    const referenced = Object.values(LEDGER_FUNCTION_PATHS);

    expect(referenced).not.toContain("inventory/ledger:postTransaction");
    expect(referenced).not.toContain("inventory/ledger:reverseTransaction");
  });

  it("restates the server's page-size cap exactly", () => {
    // A page size above the cap is refused rather than clamped, so a client
    // that guessed high would show an error instead of rows.
    expect(MAX_LEDGER_PAGE_SIZE).toBe(MAX_JOB_PAGE_SIZE);
    expect(MAX_LEDGER_PAGE_SIZE).toBe(ledger.maxLedgerPageSize);
  });

  it("asks for a page the server will accept", () => {
    expect(DEFAULT_LEDGER_PAGE_SIZE).toBeGreaterThan(0);
    expect(DEFAULT_LEDGER_PAGE_SIZE).toBeLessThanOrEqual(MAX_LEDGER_PAGE_SIZE);
  });
});

describe("master-data client contract", () => {
  /**
   * The same drift guard as the ledger's, for the same reason: the browser names
   * these functions with hand-written strings because `convex/_generated/` is a
   * git-ignored artifact, so a server-side rename would otherwise surface as
   * "function not found" in a warehouse rather than as a red build.
   */
  const modulesByPath: Readonly<Record<string, Record<string, unknown>>> = {
    "masterData/catalogue": masterData as unknown as Record<string, unknown>,
    "masterData/writes": masterDataWrites as unknown as Record<string, unknown>,
  };

  const exportFor = (path: string): RegisteredQueryShape | undefined => {
    const [modulePath, exportName] = path.split(":");
    const serverModule = modulesByPath[modulePath ?? ""];
    expect(serverModule, path).toBeDefined();
    return serverModule?.[exportName ?? ""] as RegisteredQueryShape | undefined;
  };

  it("names a function reference for each path the client uses", () => {
    expect(getFunctionName(listItemsRef)).toBe(
      MASTER_DATA_FUNCTION_PATHS.listItems,
    );
    expect(getFunctionName(listLocationsRef)).toBe(
      MASTER_DATA_FUNCTION_PATHS.listLocations,
    );
    expect(getFunctionName(listReasonCodesRef)).toBe(
      MASTER_DATA_FUNCTION_PATHS.listReasonCodes,
    );
  });

  it.each(Object.entries(MASTER_DATA_FUNCTION_PATHS))(
    "resolves %s to a registered public query on the server",
    (_name, path) => {
      const [modulePath, exportName] = path.split(":");
      const serverModule = modulesByPath[modulePath ?? ""];
      expect(serverModule, path).toBeDefined();

      const exported = serverModule?.[exportName ?? ""] as
        RegisteredQueryShape | undefined;
      expect(typeof exported, path).toBe("function");
      expect(exported?.isQuery, path).toBe(true);
      expect(exported?.isPublic, path).toBe(true);
    },
  );

  it("names a function reference for each entity path the client uses", () => {
    expect(getFunctionName(listSuppliersRef)).toBe(
      ENTITY_FUNCTION_PATHS.listSuppliers,
    );
    expect(getFunctionName(getItemRef)).toBe(ENTITY_FUNCTION_PATHS.getItem);
  });

  it.each(Object.entries(ENTITY_FUNCTION_PATHS))(
    "resolves %s to a registered public query on the server",
    (_name, path) => {
      const exported = exportFor(path);
      expect(typeof exported, path).toBe("function");
      expect(exported?.isQuery, path).toBe(true);
      expect(exported?.isPublic, path).toBe(true);
    },
  );

  it("names a function reference for each write path the client uses", () => {
    expect(getFunctionName(createSupplierRef)).toBe(
      WRITE_FUNCTION_PATHS.createSupplier,
    );
    expect(getFunctionName(publishLabelTemplateRef)).toBe(
      WRITE_FUNCTION_PATHS.publishLabelTemplate,
    );
  });

  it.each(Object.entries(WRITE_FUNCTION_PATHS))(
    "resolves %s to a registered public mutation on the server",
    (_name, path) => {
      /*
       * `isMutation` rather than only "it is defined". An export of the right
       * name that turned out to be a query would satisfy existence and still
       * fail from a browser — and a *read* reached through `useMutation` would
       * fail in the least legible way available.
       */
      const exported = exportFor(path) as
        (RegisteredQueryShape & { readonly isMutation?: boolean }) | undefined;

      expect(typeof exported, path).toBe("function");
      expect(exported?.isMutation, path).toBe(true);
      expect(exported?.isPublic, path).toBe(true);
    },
  );

  it("keeps every declared write reference wired to a screen", () => {
    /*
     * A reference with no caller is a reference nothing type-checks against,
     * which is how a server-side rename survives a build and fails in a
     * warehouse instead. This is the inverse of the old "no writes exist"
     * check: they exist, and each one is named by the feature layer.
     */
    const source = readFeatureSources();

    for (const name of Object.keys(WRITE_FUNCTION_PATHS)) {
      expect(source.includes(`${name}Ref`), `${name}Ref has no caller`).toBe(
        true,
      );
    }
  });

  it("shares the ledger's page cap, so one client loop fits both surfaces", () => {
    expect(masterData.maxMasterDataPageSize).toBe(MAX_LEDGER_PAGE_SIZE);
  });
});
