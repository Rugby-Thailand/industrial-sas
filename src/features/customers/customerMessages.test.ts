import { describe, expect, it } from "vitest";

import { ALL_CATALOGUES } from "@/i18n/messages";
import { pickMessages, ROUTE_NAMESPACES } from "@/i18n/clientMessages";

describe("customer route messages", () => {
  it("customer routes carry the Customers copy; storage pages under master-data do not", () => {
    for (const catalogue of Object.values(ALL_CATALOGUES)) {
      const customers = pickMessages(
        catalogue,
        ROUTE_NAMESPACES["(desktop)/master-data/customers"],
      );
      expect(customers.Customers).toEqual(catalogue.Customers);
      // Shared components on these pages: header/Back, panels, tables.
      for (const namespace of ["App", "Panel", "Table"] as const)
        expect(customers[namespace]).toEqual(catalogue[namespace]);
    }
    expect(ROUTE_NAMESPACES["(desktop)/master-data"]).not.toContain(
      "Customers",
    );
  });
});
