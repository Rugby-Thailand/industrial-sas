import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { ItemsTable } from "./ItemsTable";
import { LocationsTable } from "./LocationsTable";

import {
  PREVIEW_ITEMS,
  previewLocationsFor,
} from "@tests/fixtures/data/masterData";

describe("master-data table accessibility", () => {
  it.each(["th", "en"] as const)(
    "ItemsTable has no detectable axe violations in %s",
    async (locale) => {
      const { container } = renderWithIntl(
        <ItemsTable rows={PREVIEW_ITEMS} />,
        { locale },
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each(["th", "en"] as const)(
    "LocationsTable has no detectable axe violations in %s",
    async (locale) => {
      const { container } = renderWithIntl(
        <LocationsTable rows={previewLocationsFor("prv_wh_bangpoo")} />,
        { locale },
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
