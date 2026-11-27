import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

import { JobScanRecordRow } from "./JobScanRecordRow";

type Record = ComponentProps<typeof JobScanRecordRow>["record"];

function show(
  location: Partial<Record>,
  options: {
    canManage?: boolean;
    disabled?: boolean;
    locale?: "en" | "th";
    onChangeLocation?: (opener?: HTMLElement | null) => void;
    onEdit?: () => void;
    onDelete?: () => void;
    onAssist?: () => void;
  } = {},
) {
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
        canManage={options.canManage ?? false}
        selected={false}
        disabled={options.disabled ?? false}
        onToggle={() => {}}
        onChangeLocation={options.onChangeLocation ?? (() => {})}
        onDelete={options.onDelete ?? (() => {})}
        onEdit={options.onEdit ?? (() => {})}
        {...(options.onAssist ? { onAssist: options.onAssist } : {})}
      />
    </ul>,
    { locale: options.locale ?? "en", workspace: false },
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

it("links to the resolved customer when linked, and shows captured text when unlinked", () => {
  show({
    customer: "บจก.ไทยรุ่งเรือง",
    customerId: "customer-a",
    customerName: "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
    customerCode: "C-0007",
  });
  const link = screen.getByRole("link", {
    name: "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด (C-0007)",
  });
  expect(link).toHaveAttribute("href", "/master-data/customers/customer-a");

  show({ customer: "Unmatched Buyer Co." });
  expect(screen.getByText("Unmatched Buyer Co.")).toBeInTheDocument();
});

it("renders a direct location pencil button for managers in English and Thai and keeps actions menu controls", async () => {
  const user = userEvent.setup();
  const onChangeLocation = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  show(
    { mapped: false, locationText: "Dock" },
    { canManage: true, onChangeLocation, onEdit, onDelete },
  );
  const setButton = screen.getByRole("button", {
    name: "Set location for FO001",
  });
  await user.click(setButton);
  expect(onChangeLocation).toHaveBeenCalledWith(setButton);

  const actionsTrigger = screen.getByRole("button", {
    name: "Actions for record FO001",
  });
  await user.click(actionsTrigger);
  await user.click(screen.getByRole("menuitem", { name: "Change location" }));
  expect(onChangeLocation).toHaveBeenLastCalledWith(actionsTrigger);

  await user.click(actionsTrigger);
  await user.click(
    screen.getByRole("menuitem", { name: "Correct ticket details" }),
  );
  expect(onEdit).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "Delete record FO001" }));
  expect(onDelete).toHaveBeenCalledOnce();

  show(
    { factoryOrder: "FO002", mapped: true, locationCode: "F1-L1" },
    { canManage: true, locale: "th" },
  );
  expect(
    screen.getByRole("button", { name: "เปลี่ยนตำแหน่ง FO002" }),
  ).toBeInTheDocument();

  show(
    { factoryOrder: "FO003", mapped: false, locationText: "Dock" },
    { canManage: true, locale: "th" },
  );
  expect(
    screen.getByRole("button", { name: "ระบุตำแหน่ง FO003" }),
  ).toBeInTheDocument();
});

it("hides the direct location pencil button for viewers and disables it when busy", () => {
  show({ mapped: false, locationText: "Dock" }, { canManage: false });
  expect(
    screen.queryByRole("button", { name: /Set location|Change location/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Dock")).toBeInTheDocument();
  expect(screen.getByText("Not set")).toBeInTheDocument();

  show(
    { factoryOrder: "FO004", mapped: true, locationCode: "F1-L1" },
    { canManage: true, disabled: true },
  );
  expect(
    screen.getByRole("button", { name: "Change location for FO004" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Actions for record FO004" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Delete record FO004" }),
  ).toBeDisabled();
});

it("offers AI edit inside the row actions menu after focus returns to it, in English and Thai", async () => {
  const user = userEvent.setup();
  const onAssist = vi.fn();
  const onEdit = vi.fn();
  show(
    { mapped: true, locationCode: "F1-L1" },
    { canManage: true, onAssist, onEdit },
  );
  expect(
    screen.queryByRole("button", { name: /with AI/ }),
  ).not.toBeInTheDocument();
  const menu = screen.getByRole("button", { name: "Actions for record FO001" });
  await user.click(menu);
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["Correct ticket details", "Edit with AI", "Change location"]);
  await user.click(screen.getByRole("menuitem", { name: "Edit with AI" }));
  await waitFor(() => expect(onAssist).toHaveBeenCalledOnce());
  expect(menu).toHaveFocus();
  expect(onEdit).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Delete record FO001" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Change location for FO001" }),
  ).toBeVisible();

  show(
    { factoryOrder: "FO005", mapped: true, locationCode: "F1-L1" },
    { canManage: true, locale: "th", onAssist },
  );
  await user.click(
    screen.getByRole("button", { name: "ตัวเลือกรายการ FO005" }),
  );
  expect(
    screen.getByRole("menuitem", { name: "AI ช่วยแก้ไข" }),
  ).toBeInTheDocument();
});
