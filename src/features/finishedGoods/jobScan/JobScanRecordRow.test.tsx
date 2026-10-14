import { screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, it } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { JobScanRecordRow } from "./JobScanRecordRow";

type Record = ComponentProps<typeof JobScanRecordRow>["record"];

function show(location: Partial<Record>) {
  const record = {
    id: "scan-a",
    factoryOrder: "FO001",
    productBarcodeText: "PRODUCT-A",
    locationText: "F1-L1",
    mapped: true,
    source: "MANUAL",
    createdAt: 1000,
    version: 1,
    ...location,
  } as Record;
  renderWithIntl(
    <ul>
      <JobScanRecordRow
        record={record}
        canManage={false}
        selected={false}
        disabled={false}
        onToggle={() => {}}
        onChangeLocation={() => {}}
        onDelete={() => {}}
        onEdit={() => {}}
      />
    </ul>,
    { locale: "en", workspace: false },
  );
}

it.each([
  ["a registered name equal to the code", { locationName: "F1-L1-1" }],
  ["a mapped original label equal to the code", { locationText: "F1-L1-1" }],
])("shows the location code once for %s", (_case, location) => {
  show({ locationCode: "F1-L1-1", ...location });
  expect(screen.getAllByText("F1-L1-1")).toHaveLength(1);
});

it.each([
  ["registered name", { locationName: "North dock" }, "North dock"],
  ["original label", { locationText: "Dock 1" }, "Dock 1"],
])("keeps a distinct %s beside the code", (_case, location, name) => {
  show({ locationCode: "F1-L1-1", ...location });
  expect(screen.getByText("F1-L1-1")).toBeVisible();
  expect(screen.getByText(name)).toBeInTheDocument();
});

it("shows unmapped free text once, as the location", () => {
  show({ mapped: false, locationText: "Dock" });
  expect(screen.getAllByText("Dock")).toHaveLength(1);
});
