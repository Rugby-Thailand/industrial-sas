import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PalletDetail } from "@/lib/convex/finishedGoodsApi";
import type { writeSuccess } from "@tests/fixtures/finished-goods-ui";

const mocks = vi.hoisted(() => ({
  canManage: true,
  authLoaded: true,
  actorId: "user-a",
  push: vi.fn(),
  query: vi.fn<(name: string) => unknown>(),
  write:
    vi.fn<
      (name: string, args: unknown) => Promise<ReturnType<typeof writeSuccess>>
    >(),
}));
vi.mock("@clerk/nextjs", async (importOriginal) => {
  const actual = await importOriginal<typeof ClerkModule>();
  return {
    ...actual,
    useAuth: () => ({ isLoaded: mocks.authLoaded, userId: mocks.actorId }),
  };
});
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceModule>();
  return {
    ...actual,
    useWorkspace: () => ({
      ...finishedGoodsWorkspace,
      navigationPermissions: mocks.canManage
        ? finishedGoodsWorkspace.navigationPermissions
        : ["masterData.storageLayout.read"],
    }),
  };
});
vi.mock("convex/react", () => ({
  useMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.write(getFunctionName(ref), args),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : mocks.query(getFunctionName(ref)),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: mocks.push }),
}));

import {
  finishedGoodsWorkspace,
  finishedGoodDestination,
  finishedGoodPlacement,
  querySuccess,
  reservedPalletDetail,
  writeSuccess as success,
} from "@tests/fixtures/finished-goods-ui";
import { MoveScreen } from "./MoveScreen";
import { PalletScreen } from "./PalletScreens";

let currentDetail: PalletDetail;
const storedDetail: PalletDetail = {
  ...reservedPalletDetail,
  pallet: { ...reservedPalletDetail.pallet, status: "STORED" },
  placement: { ...finishedGoodPlacement, status: "STORED" },
};
function active(status: "RESERVED" | "IN_TRANSIT" = "RESERVED"): PalletDetail {
  return {
    ...storedDetail,
    activeMove: {
      _id: "move-a",
      _creationTime: 1000,
      orgId: "org-a",
      warehouseId: "warehouse-a",
      palletId: "pallet-a",
      sourcePlacementId: "placement-a",
      targetPlacementId: "placement-b",
      sourceUpdatedAt: 1000,
      targetUpdatedAt: 1000,
      palletUpdatedAt: 1000,
      ownerUserId: "user-a",
      status,
      createdAt: 1000,
      updatedAt: 1000,
      createdByUserId: "user-a",
      updatedByUserId: "user-a",
      sourcePlacement: storedDetail.placement,
      targetPlacement: {
        ...finishedGoodPlacement,
        _id: "placement-b",
        xMm: 500,
      },
      sourceDestination: finishedGoodDestination,
      targetDestination: { ...finishedGoodDestination, xMm: 500 },
      isOwner: true,
      canManageMove: true,
      destinationVerifiedForCurrentUser: false,
    },
  };
}
function renderMove(locale = "en") {
  const element = () => (
    <NextIntlClientProvider
      locale={locale}
      messages={{}}
      timeZone="Asia/Bangkok"
    >
      <MoveScreen palletId="pallet-a" />
    </NextIntlClientProvider>
  );
  const result = render(element());
  return { ...result, refresh: () => result.rerender(element()) };
}
const callsFor = (name: string) =>
  mocks.write.mock.calls.filter(([method]) => method.endsWith(`:${name}`));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.canManage = true;
  mocks.authLoaded = true;
  mocks.actorId = "user-a";
  currentDetail = storedDetail;
  mocks.push.mockReset();
  mocks.write.mockReset().mockResolvedValue(success("move-a"));
  mocks.query.mockReset().mockImplementation((name) =>
    name.endsWith(":getPallet")
      ? querySuccess(currentDetail)
      : querySuccess({
          candidates: [{ ...finishedGoodDestination, xMm: 500 }],
          reasons: [],
        }),
  );
});
function enterCode(label: string, value: string) {
  if (!screen.queryByRole("textbox", { name: label }))
    fireEvent.click(screen.getByRole("button", { name: "Scan QR (optional)" }));
  fireEvent.change(screen.getByRole("textbox", { name: label }), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify entered code" }));
}
describe("stored pallet movement", () => {
  it("clears the checkbox when a target revision changes or the screen is reopened", () => {
    currentDetail = active("IN_TRANSIT");
    const view = renderMove();
    fireEvent.click(screen.getByRole("checkbox"));
    currentDetail = {
      ...currentDetail,
      activeMove: {
        ...currentDetail.activeMove!,
        targetUpdatedAt: currentDetail.activeMove!.targetUpdatedAt + 1,
      },
    };
    view.refresh();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    view.unmount();
    renderMove();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it.each(["RESERVED", "IN_TRANSIT"] as const)(
    "confirms %s with a checkbox and no identity input",
    async (status) => {
      currentDetail = active(status);
      renderMove();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      const button = screen.getByRole("button", {
        name: status === "RESERVED" ? "Start move" : "Confirm move complete",
      });
      expect(button).toBeDisabled();
      fireEvent.click(screen.getByRole("checkbox"));
      expect(button).toBeEnabled();
      fireEvent.click(button);
      const operation = status === "RESERVED" ? "startMove" : "completeMove";
      await waitFor(() => expect(callsFor(operation)).toHaveLength(1));
      expect(callsFor(operation)[0]?.[1]).toMatchObject({
        confirmationMethod: "ACKNOWLEDGEMENT",
        physicalConfirmed: true,
      });
      expect(callsFor(operation)[0]?.[1]).not.toHaveProperty("code");
    },
  );
  it("clears acknowledgement on changing verification method and allows an explicit checkbox fallback", () => {
    currentDetail = active("IN_TRANSIT");
    renderMove();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Scan QR (optional)" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Confirm move complete" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Use checkbox instead" }),
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Confirm move complete" }),
    ).toBeEnabled();
  });
  it("returns to the held source using acknowledgement only", async () => {
    currentDetail = active("IN_TRANSIT");
    renderMove();
    fireEvent.click(screen.getByRole("button", { name: "Return to source" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm returned" }),
    );
    await waitFor(() => expect(callsFor("returnMove")).toHaveLength(1));
    expect(callsFor("returnMove")[0]?.[1]).toMatchObject({
      confirmationMethod: "ACKNOWLEDGEMENT",
      physicalConfirmed: true,
    });
  });

  it.each([
    ["en", "Current stored position", "From", "Floor 4", "Orientation"],
    ["th", "ตำแหน่งจัดเก็บปัจจุบัน", "จาก", "ชั้น 4", "ทิศทาง"],
  ])(
    "shows the exact current source compactly in %s without changing it when editing a destination",
    (locale, sourceLabel, fromLabel, floorLabel, orientationLabel) => {
      currentDetail = {
        ...storedDetail,
        placement: {
          ...finishedGoodPlacement,
          status: "STORED",
          xMm: 125,
          yMm: 350,
          zMm: 1400,
          rotation: 90,
        },
        destination: {
          ...finishedGoodDestination,
          supportLabel: "Lower P-002",
          positionCode: "POS-007",
        },
      };
      renderMove(locale);
      const source = screen.getByRole("region", { name: sourceLabel });
      expect(
        within(source).getByRole("heading", { name: fromLabel }),
      ).toBeInTheDocument();
      for (const identity of [
        "BLDG-A",
        floorLabel,
        "FG-1",
        "Lower P-002",
        "POS-007",
      ]) {
        expect(source).toHaveTextContent(identity);
      }
      expect(source).toHaveTextContent("X0.125 m");
      expect(source).toHaveTextContent("Y0.35 m");
      expect(source).toHaveTextContent(
        locale === "en" ? "Base elevation1.4 m" : "ระดับฐาน1.4 m",
      );
      expect(source).toHaveTextContent(`${orientationLabel}90°`);
      fireEvent.change(screen.getByRole("spinbutton", { name: "X (m)" }), {
        target: { value: "0.7" },
      });
      expect(source).toHaveTextContent("X0.125 m");
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("searches location names/codes, buildings, floors and supports without changing the destination", () => {
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: [
              { ...finishedGoodDestination, xMm: 500 },
              {
                ...finishedGoodDestination,
                zoneId: "zone-b",
                locationId: "location-b",
                locationName: "Dispatch",
                locationCode: "SHIP-Z02",
                buildingName: "Outbound Warehouse",
                buildingCode: "OUT-B",
                floorNumber: 7,
                supportPositionId: "rack-b",
                supportLabel: "Loading rack",
                supportCode: "RACK-07",
              },
            ],
            reasons: [],
          }),
    );
    renderMove();
    const search = screen.getByRole("textbox", {
      name: "Search move destinations",
    });
    for (const value of [
      "dispatch",
      "SHIP-Z02",
      "outbound",
      "out-b",
      "Floor 7",
      "ชั้น 7",
      "Loading rack",
      "rack-07",
    ]) {
      fireEvent.change(search, { target: { value } });
      const options = screen.getByRole("region", {
        name: "Destination options",
      });
      expect(within(options).getAllByRole("button")).toHaveLength(1);
      expect(
        within(options).getByRole("button", { name: /Dispatch/ }),
      ).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(
        0.5,
      );
      expect(screen.getByText("1 / 2")).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(
      within(
        screen.getByRole("region", { name: "Destination options" }),
      ).getAllByRole("button"),
    ).toHaveLength(2);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps the selected destination and edited coordinates through an empty search and clear", async () => {
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: [
              { ...finishedGoodDestination, xMm: 500 },
              {
                ...finishedGoodDestination,
                zoneId: "zone-b",
                locationId: "location-b",
                locationName: "Dispatch",
                xMm: 600,
              },
            ],
            reasons: [],
          }),
    );
    renderMove();
    fireEvent.click(
      within(
        screen.getByRole("region", { name: "Destination options" }),
      ).getByRole("button", { name: /Dispatch/ }),
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "X (m)" }), {
      target: { value: "0.7" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search move destinations" }),
      { target: { value: "missing location" } },
    );
    expect(screen.getByText("No matching destinations")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByText("0 / 2")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(0.7);
    expect(mocks.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      within(
        screen.getByRole("region", { name: "Destination options" }),
      ).getByRole("button", { name: /Dispatch/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(0.7);
    fireEvent.click(
      screen.getByRole("button", { name: "Reserve this position" }),
    );
    await waitFor(() => expect(callsFor("reserveMove")).toHaveLength(1));
    expect(callsFor("reserveMove")[0]?.[1]).toMatchObject({
      zoneId: "zone-b",
      xMm: 700,
    });
  });

  it("automatically selects a pallet top during movement and preserves its support", async () => {
    const stack = {
      ...finishedGoodDestination,
      supportPalletId: "lower-pallet",
      supportCode: "LOWER-1",
      zMm: 1400,
      support: {
        ...finishedGoodDestination.support,
        zMm: 1400,
        heightMm: 1600,
      },
    };
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: [finishedGoodDestination, stack],
            reasons: [],
          }),
    );
    renderMove();
    fireEvent.change(screen.getByRole("spinbutton", { name: "X (m)" }), {
      target: { value: "0.3" },
    });
    expect(
      screen.getByText(/Position: X 0.3 m · Y 0.2 m · Z 1.4 m/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reserve this position" }),
    );
    await waitFor(() => expect(callsFor("reserveMove")).toHaveLength(1));
    expect(callsFor("reserveMove")[0]?.[1]).toMatchObject({
      supportPalletId: "lower-pallet",
      expectedSourcePlacementId: "placement-a",
    });
    expect(callsFor("reserveMove")[0]?.[1]).not.toHaveProperty("zMm");
  });

  it("reviews source and target before reserving with a source revision", async () => {
    renderMove();
    expect(screen.getAllByText("From").length).toBeGreaterThan(0);
    expect(screen.getAllByText("To").length).toBeGreaterThan(0);
    expect(mocks.write).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Reason (optional)" }),
      { target: { value: "Closer to dispatch" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reserve this position" }),
    );
    await waitFor(() => expect(callsFor("reserveMove")).toHaveLength(1));
    expect(callsFor("reserveMove")[0]?.[1]).toMatchObject({
      palletId: "pallet-a",
      expectedSourcePlacementId: "placement-a",
      xMm: 500,
      yMm: 200,
    });
  });
  it("does not reserve an unchanged position", () => {
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({ candidates: [finishedGoodDestination], reasons: [] }),
    );
    renderMove();
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Choose a different position or orientation."),
    ).toBeInTheDocument();
  });
  it("requires correct pallet identification and physical pickup", async () => {
    currentDetail = active();
    renderMove();
    const start = screen.getByRole("button", { name: "Start move" });
    expect(start).toBeDisabled();
    enterCode("Pallet code", "WRONG");
    await waitFor(() =>
      expect(
        screen.getByText(/This code does not identify/),
      ).toBeInTheDocument(),
    );
    expect(callsFor("startMove")).toHaveLength(0);
    enterCode("Pallet code", "P-001");
    await screen.findByText("Pallet identified");
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Picked up/ }));
    fireEvent.click(start);
    await waitFor(() => expect(callsFor("startMove")).toHaveLength(1));
    expect(callsFor("startMove")[0]?.[1]).toMatchObject({
      code: "P-001",
      method: "MANUAL",
      physicalConfirmed: true,
      moveId: "move-a",
    });
  });
  it("resumes transit and requires current operator verification plus placement acknowledgement", async () => {
    currentDetail = active("IN_TRANSIT");
    const view = renderMove();
    expect(
      screen.queryByRole("button", { name: "Start move" }),
    ).not.toBeInTheDocument();
    const complete = screen.getByRole("button", {
      name: "Confirm move complete",
    });
    expect(complete).toBeDisabled();
    enterCode("Destination code", finishedGoodDestination.locationQrValue);
    await waitFor(() =>
      expect(callsFor("verifyMoveDestination")).toHaveLength(1),
    );
    expect(complete).toBeDisabled();
    currentDetail = {
      ...currentDetail,
      activeMove: {
        ...currentDetail.activeMove!,
        destinationVerifiedForCurrentUser: true,
      },
    };
    view.refresh();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /shown position and orientation/ }),
    );
    fireEvent.click(complete);
    await waitFor(() => expect(callsFor("completeMove")).toHaveLength(1));
    expect(callsFor("completeMove")[0]?.[1]).toMatchObject({
      physicalConfirmed: true,
    });
  });
  it("blocks another operator from mutating a move", () => {
    currentDetail = active("IN_TRANSIT");
    currentDetail = {
      ...currentDetail,
      activeMove: { ...currentDetail.activeMove!, isOwner: false },
    };
    renderMove();
    expect(screen.getByText("View-only move")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm move complete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Return to source" }),
    ).not.toBeInTheDocument();
  });
  it("offers a verified physical return, never cancel after pickup", async () => {
    currentDetail = active("IN_TRANSIT");
    renderMove();
    expect(
      screen.queryByRole("button", { name: "Cancel move" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Return to source" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm returned",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Scan source QR (optional)" }),
    );
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Source code" }),
      { target: { value: finishedGoodDestination.locationQrValue } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify entered code" }),
    );
    await within(dialog).findByText("Source code captured");
    expect(confirm).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /Returned P-/ }),
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(callsFor("returnMove")).toHaveLength(1));
  });
  it("keeps the prepared move on a failed cancellation and retries the same request", async () => {
    currentDetail = active();
    mocks.write.mockRejectedValueOnce(new Error("Connection lost"));
    renderMove();
    fireEvent.click(screen.getByRole("button", { name: "Cancel move" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel move" }),
    );
    await waitFor(() => expect(callsFor("cancelMove")).toHaveLength(1));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel move" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel move" }),
    );
    await waitFor(() => expect(callsFor("cancelMove")).toHaveLength(2));
    expect(callsFor("cancelMove")[0]?.[1]).toEqual(
      callsFor("cancelMove")[1]?.[1],
    );
  });
  it("replaces a prepared destination using the same move identity", async () => {
    currentDetail = active();
    renderMove();
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Reserve this position" }),
    );
    await waitFor(() => expect(callsFor("reserveMove")).toHaveLength(1));
    expect(callsFor("reserveMove")[0]?.[1]).toMatchObject({
      moveId: "move-a",
      expectedSourcePlacementId: "placement-a",
    });
    await screen.findByRole("button", { name: "Start move" });
  });
  it("records an issue without offering a cancel after pickup", async () => {
    currentDetail = active("IN_TRANSIT");
    renderMove();
    fireEvent.click(screen.getByRole("button", { name: "Report an issue" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Save issue" }),
    ).toBeDisabled();
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Describe the issue" }),
      { target: { value: "Aisle is blocked" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save issue" }));
    await waitFor(() => expect(callsFor("reportMoveIssue")).toHaveLength(1));
    expect(callsFor("cancelMove")).toHaveLength(0);
    await screen.findByText("Issue saved. Both spaces remain held.");
  });
  it("shows no-fit without changing the source and blocks read-only direct navigation", () => {
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({ candidates: [], reasons: ["NO_FREE_FOOTPRINT"] }),
    );
    const view = renderMove();
    expect(screen.getByText("No suitable space found")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Current stored position" }),
    ).toBeInTheDocument();
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.canManage = false;
    view.refresh();
    expect(screen.getByText("View-only access")).toBeInTheDocument();
    expect(
      screen.queryByText("From · Current stored position"),
    ).not.toBeInTheDocument();
  });
  it("shows the move state in both workspace and detail summaries, never a green Stored badge", () => {
    currentDetail = active("IN_TRANSIT");
    const view = renderMove();
    expect(
      screen.queryByText("Stored", { exact: true }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Moving", { exact: true })).toBeInTheDocument();
    view.unmount();
    render(
      <NextIntlClientProvider locale="en" messages={{}} timeZone="Asia/Bangkok">
        <PalletScreen palletId="pallet-a" />
      </NextIntlClientProvider>,
    );
    expect(
      screen.queryByText("Stored", { exact: true }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Moving", { exact: true })).toBeInTheDocument();
    expect(
      screen.getByText("Last confirmed source position · Pallet in transit"),
    ).toBeInTheDocument();
  });
});

it.each(["en", "th"])(
  "excludes non-fitting previews from available move destinations in %s",
  (locale) => {
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: [finishedGoodDestination],
            previewCandidates: [
              {
                ...finishedGoodDestination,
                zoneId: "full-zone",
                locationName: "FULL-B unavailable",
              },
              {
                ...finishedGoodDestination,
                zoneId: "small-rack",
                locationName: "Rack too small",
              },
            ],
            reasons: [],
          }),
    );
    renderMove(locale);
    expect(screen.queryByText("FULL-B unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Rack too small")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name:
          locale === "en" ? /^Available destinations\s*1$/ : /^ปลายทางที่ใช้ได้\s*1$/,
      }),
    ).toBeVisible();
  },
);

it("shows no suitable move destination when only invalid previews remain", () => {
  mocks.query.mockImplementation((name) =>
    name.endsWith(":getPallet")
      ? querySuccess(currentDetail)
      : querySuccess({
          candidates: [],
          previewCandidates: [
            { ...finishedGoodDestination, locationName: "FULL-B unavailable" },
          ],
          reasons: ["HEIGHT_EXCEEDED"],
        }),
  );
  renderMove();
  expect(screen.getByText("No suitable space found")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Reserve this position" }),
  ).not.toBeInTheDocument();
  expect(mocks.write).not.toHaveBeenCalled();
});
