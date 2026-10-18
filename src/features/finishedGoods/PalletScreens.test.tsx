import { messagesFor } from "@/i18n/messages";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalletDetail } from "@/lib/convex/finishedGoodsApi";
import type { writeSuccess } from "@tests/fixtures/finished-goods-ui";

const mocks = vi.hoisted(() => ({
  canManage: true,
  authLoaded: true,
  actorId: "user-a",
  push: vi.fn(),
  replace: vi.fn(),
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
  useRouter: () => ({
    push: mocks.push,
    replace: (href: string) => {
      mocks.replace(href);
      const locale = window.location.pathname.startsWith("/th/") ? "th" : "en";
      window.history.replaceState({}, "", `/${locale}${href}`);
    },
    back: () => window.history.back(),
  }),
}));

import {
  finishedGoodsWorkspace,
  finishedGoodDestination,
  finishedGoodPallet,
  measuredPalletDetail,
  querySuccess,
  reservedPalletDetail,
  writeFailure,
  writeSuccess as success,
} from "@tests/fixtures/finished-goods-ui";
import { PalletScreen } from "./PalletScreens";
import { Summary } from "./PalletSummary";
import {
  recommendationReason,
  recommendationReasons,
} from "./recommendationReason";

let currentDetail: PalletDetail;
const renderPallet = (view: "measure" | "storage" | "detail" = "detail") => {
  const element = () => (
    <NextIntlClientProvider
      locale="en"
      messages={messagesFor("en")}
      timeZone="Asia/Bangkok"
    >
      <PalletScreen palletId="pallet-a" view={view} />
    </NextIntlClientProvider>
  );
  const rendered = render(element());
  return { ...rendered, refresh: () => rendered.rerender(element()) };
};
function number(label: string, value: string) {
  fireEvent.change(screen.getByRole("spinbutton", { name: label }), {
    target: { value },
  });
}
const callsFor = (name: string) =>
  mocks.write.mock.calls.filter(([method]) => method.endsWith(`:${name}`));

beforeEach(() => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/pallets/pallet-a",
  );
  localStorage.clear();
  sessionStorage.clear();
  mocks.canManage = true;
  mocks.authLoaded = true;
  mocks.actorId = "user-a";
  currentDetail = measuredPalletDetail;
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.write.mockReset().mockResolvedValue(success("pallet-a"));
  mocks.query
    .mockReset()
    .mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({ candidates: [finishedGoodDestination], reasons: [] }),
    );
});

describe("contextual location corrections", () => {
  it("places the move and layout links next to the stored destination", () => {
    currentDetail = {
      ...reservedPalletDetail,
      pallet: { ...reservedPalletDetail.pallet, status: "STORED" },
    };
    renderPallet();
    const destination = screen.getByRole("region", {
      name: "Exact destination",
    });
    expect(
      within(destination).getByRole("link", { name: "Move pallet" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/pallet-a/move");
    expect(
      within(destination).getByRole("link", { name: "View storage layout" }),
    ).toHaveAttribute(
      "href",
      "/master-data/storage-layouts/building-a/floors/4#storage-zone-zone-a",
    );
    expect(screen.getAllByRole("link", { name: "Move pallet" })).toHaveLength(
      1,
    );
    expect(
      within(destination).getByRole("link", { name: "Edit location details" }),
    ).toHaveAttribute(
      "href",
      "/master-data/storage-layouts/building-a/floors/4?editZone=zone-a#storage-zone-zone-a",
    );
  });

  it("changes a reservation through the storage workflow without mutating it on click", () => {
    currentDetail = reservedPalletDetail;
    renderPallet();
    const destination = screen.getByRole("region", {
      name: "Exact destination",
    });
    expect(
      within(destination).getByRole("link", {
        name: "Change storage position",
      }),
    ).toHaveAttribute("href", "/finished-goods/pallets/pallet-a/storage");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not expose a correction to a view-only user", () => {
    mocks.canManage = false;
    currentDetail = {
      ...reservedPalletDetail,
      pallet: { ...reservedPalletDetail.pallet, status: "STORED" },
    };
    renderPallet();
    expect(
      screen.queryByRole("link", { name: "Edit location details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Move pallet" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View storage layout" }),
    ).toBeVisible();
  });
});

describe("pallet next-action hierarchy", () => {
  it("offers measured storage once in the page header while keeping scanning available", () => {
    renderPallet();
    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    expect(header).not.toBeNull();
    expect(
      within(header!).getByRole("link", { name: "Recommend storage" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/pallet-a/storage");
    expect(
      screen.getAllByRole("link", { name: "Recommend storage" }),
    ).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Scan Packages" })).toHaveAttribute(
      "href",
      "/finished-goods/packages/scan?unitId=pallet-a",
    );
  });

  it("directs an unmeasured unit to scanning without offering storage prematurely", () => {
    currentDetail = {
      ...measuredPalletDetail,
      pallet: { ...finishedGoodPallet, status: "AWAITING_MEASUREMENT" },
    };
    renderPallet();
    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    expect(
      within(header!).getByRole("link", { name: "Scan Packages" }),
    ).toHaveAttribute("href", "/finished-goods/packages/scan?unitId=pallet-a");
    expect(screen.getAllByRole("link", { name: "Scan Packages" })).toHaveLength(
      1,
    );
    expect(
      screen.queryByRole("link", { name: "Recommend storage" }),
    ).not.toBeInTheDocument();
  });

  it("offers package-label storage when a dimensionless simple-batch unit opens storage", () => {
    currentDetail = {
      ...measuredPalletDetail,
      pallet: {
        ...finishedGoodPallet,
        status: "AWAITING_PLACEMENT",
        preparationBatchId: "batch-a",
        sameSize: false,
        fillPercent: 70,
      },
    };
    renderPallet("storage");
    expect(
      screen.getByRole("heading", { name: "Measure before choosing storage" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Scan Packages" })).toHaveAttribute(
      "href",
      "/finished-goods/packages/scan?unitId=pallet-a",
    );
    expect(
      screen.getByRole("link", { name: "Measure pallet" }),
    ).toHaveAttribute(
      "href",
      "/finished-goods/products/product-a?editUnit=pallet-a",
    );
    expect(
      screen.getByText(/scan its package label to record only its location/),
    ).toBeVisible();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("offers package-label storage beside the batch editor on the measure route", () => {
    currentDetail = {
      ...measuredPalletDetail,
      pallet: {
        ...finishedGoodPallet,
        status: "AWAITING_PLACEMENT",
        preparationBatchId: "batch-a",
        sameSize: false,
      },
    };
    renderPallet("measure");
    expect(
      screen.getByRole("link", { name: "Open preparation batch" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Scan Packages" })).toHaveAttribute(
      "href",
      "/finished-goods/packages/scan?unitId=pallet-a",
    );
  });

  it("does not offer package-label storage for a unit that is moving or read-only", () => {
    currentDetail = {
      ...reservedPalletDetail,
      pallet: {
        ...finishedGoodPallet,
        status: "AWAITING_PLACEMENT",
        preparationBatchId: "batch-a",
      },
      activeMove: { status: "RESERVED" },
    } as PalletDetail;
    renderPallet("measure");
    expect(
      screen.queryByRole("link", { name: "Scan Packages" }),
    ).not.toBeInTheDocument();
    cleanup();
    mocks.canManage = false;
    currentDetail = {
      ...measuredPalletDetail,
      pallet: {
        ...finishedGoodPallet,
        status: "AWAITING_PLACEMENT",
        preparationBatchId: "batch-a",
      },
    };
    renderPallet("measure");
    expect(
      screen.getByRole("link", { name: "Open preparation batch" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Scan Packages" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the operational status visible when secondary pallet details are collapsed", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={messagesFor("en")}
        timeZone="Asia/Bangkok"
      >
        <Summary detail={reservedPalletDetail} compact />
      </NextIntlClientProvider>,
    );
    const status = screen.getByText("Reserved · Awaiting storage");
    expect(status).toBeVisible();
    expect(status.closest("details")).toBeNull();
  });
});

describe("physical pallet measurement", () => {
  it("routes preparation-batch measurements back to the single packing form", () => {
    currentDetail = {
      ...measuredPalletDetail,
      pallet: {
        ...measuredPalletDetail.pallet,
        preparationBatchId: "batch-a",
        storageFormat: "BOX",
      },
    };
    renderPallet("measure");
    expect(
      screen.getByRole("link", { name: "Open preparation batch" }),
    ).toHaveAttribute(
      "href",
      "/finished-goods/products/product-a?editUnit=pallet-a",
    );
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
  it("uses box labels for a legacy box during measurement", () => {
    currentDetail = {
      ...measuredPalletDetail,
      pallet: { ...measuredPalletDetail.pallet, storageFormat: "BOX" },
    };
    renderPallet("measure");
    expect(screen.getByRole("heading", { name: "Measure box" })).toBeVisible();
    expect(screen.getByRole("group", { name: "This box" })).toBeVisible();
    expect(screen.queryByText("Physical pallet")).not.toBeInTheDocument();
  });
  it("locks allocated quantity while allowing pending pallet measurement edits", async () => {
    currentDetail = {
      ...measuredPalletDetail,
      pallet: {
        ...measuredPalletDetail.pallet,
        packingBatchId: "packing-qa",
      },
    };
    renderPallet("measure");
    expect(
      screen.getByRole("spinbutton", { name: "Actual quantity" }),
    ).toBeDisabled();
    number("Height (m)", "1.6");
    fireEvent.click(
      screen.getByRole("button", { name: "Save and find storage" }),
    );
    await waitFor(() => expect(callsFor("saveMeasurement")).toHaveLength(1));
    expect(callsFor("saveMeasurement")[0]?.[1]).toMatchObject({
      quantity: currentDetail.pallet.quantity,
      heightMm: 1600,
    });
  });

  it("converts units without changing physical measurements and saves millimetres", async () => {
    renderPallet("measure");
    expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
      1.2,
    );
    fireEvent.click(screen.getByRole("button", { name: "Centimetres" }));
    expect(screen.getByRole("spinbutton", { name: "Length (cm)" })).toHaveValue(
      120,
    );
    expect(screen.getByRole("spinbutton", { name: "Width (cm)" })).toHaveValue(
      100,
    );
    expect(screen.getByRole("spinbutton", { name: "Height (cm)" })).toHaveValue(
      140,
    );
    fireEvent.click(screen.getByRole("button", { name: "Metres" }));
    expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
      1.2,
    );
    number("Actual quantity", "250");
    fireEvent.click(
      screen.getByRole("button", { name: "Save and find storage" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Confirm the actual outside dimensions",
      ),
    );
    expect(callsFor("saveMeasurement")).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I checked the outside dimensions again after changing the quantity.",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save and find storage" }),
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-a/storage",
      ),
    );
    expect(callsFor("saveMeasurement")[0]?.[1]).toMatchObject({
      lengthMm: 1200,
      widthMm: 1000,
      heightMm: 1400,
      quantity: 250,
      dimensionsChecked: true,
      palletId: "pallet-a",
      warehouseId: "warehouse-a",
    });
  });

  it("allows incomplete measurements to be saved for later without requesting storage", async () => {
    currentDetail = { ...measuredPalletDetail, pallet: finishedGoodPallet };
    renderPallet("measure");
    expect(
      screen.getByRole("button", { name: "Save and find storage" }),
    ).toBeDisabled();
    number("Length (m)", "1.2");
    fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-a",
      ),
    );
    expect(callsFor("saveMeasurement")[0]?.[1]).toMatchObject({
      lengthMm: 1200,
    });
    expect(callsFor("saveMeasurement")[0]?.[1]).not.toHaveProperty("widthMm");
    expect(callsFor("saveMeasurement")[0]?.[1]).not.toHaveProperty("heightMm");
    expect(callsFor("reserve")).toHaveLength(0);
  });

  it.each(["", "0", "-1"])(
    "disables storage search for invalid height %j",
    (height) => {
      renderPallet("measure");
      number("Height (m)", height);
      expect(
        screen.getByRole("button", { name: "Save and find storage" }),
      ).toBeDisabled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("retains measurement input after server refusal", async () => {
    mocks.write.mockResolvedValue(writeFailure("FIELD_INVALID", "weightKg"));
    renderPallet("measure");
    number("Weight in kg (optional)", "-5");
    fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(
      screen.getByRole("spinbutton", { name: "Weight in kg (optional)" }),
    ).toHaveValue(-5);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("restores measurement drafts after remount including the selected unit", () => {
    const first = renderPallet("measure");
    fireEvent.click(screen.getByRole("button", { name: "Centimetres" }));
    number("Length (cm)", "135");
    first.unmount();
    renderPallet("measure");
    expect(screen.getByRole("spinbutton", { name: "Length (cm)" })).toHaveValue(
      135,
    );
    expect(screen.getByRole("button", { name: "Centimetres" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows reserved instructions instead of allowing a reserved pallet to be remeasured", () => {
    currentDetail = reservedPalletDetail;
    renderPallet("measure");
    expect(
      screen.getByRole("heading", { name: "Move pallet to storage" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save and find storage" }),
    ).not.toBeInTheDocument();
  });
});

describe("measurement revision", () => {
  it("preserves the pallet identity when returning to product details", () => {
    renderPallet("measure");
    expect(
      screen.getByRole("link", { name: "Packaging cartons" }),
    ).toHaveAttribute(
      "href",
      "/finished-goods/products/product-a?resumePalletId=pallet-a",
    );
  });

  it("omits a cleared existing dimension and weight in Save and exit", async () => {
    renderPallet("measure");
    number("Height (m)", "");
    fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-a",
      ),
    );
    expect(callsFor("saveMeasurement")[0]?.[1]).toMatchObject({
      lengthMm: 1200,
      widthMm: 1000,
    });
    expect(callsFor("saveMeasurement")[0]?.[1]).not.toHaveProperty("heightMm");
    expect(callsFor("saveMeasurement")[0]?.[1]).not.toHaveProperty("weightKg");
  });
});

describe("measurement command lifecycle", () => {
  it("uses a fresh command when returning to old measurements after a successful later revision", async () => {
    let view = renderPallet("measure");
    fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
    await waitFor(() => expect(callsFor("saveMeasurement")).toHaveLength(1));
    const firstArgs = callsFor("saveMeasurement")[0]?.[1];
    view.unmount();
    view = renderPallet("measure");
    number("Length (m)", "1.3");
    fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
    await waitFor(() => expect(callsFor("saveMeasurement")).toHaveLength(2));
    view.unmount();
    renderPallet("measure");
    fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
    await waitFor(() => expect(callsFor("saveMeasurement")).toHaveLength(3));
    const thirdArgs = callsFor("saveMeasurement")[2]?.[1];
    expect(thirdArgs).not.toEqual(firstArgs);
  });
});

describe("exact storage recommendations", () => {
  it.each(["other spot", "wh-b", "rack beta"])(
    "filters location options by %s without changing the preview or recommended badge",
    (search) => {
      const alternative = {
        ...finishedGoodDestination,
        zoneId: "zone-other",
        buildingCode: "WH-B",
        locationName: "Other spot",
        supportLabel: "Rack Beta",
        xMm: 500,
      };
      mocks.query.mockImplementation((name) =>
        name.endsWith(":getPallet")
          ? querySuccess(currentDetail)
          : querySuccess({
              candidates: [finishedGoodDestination, alternative],
              reasons: [],
            }),
      );
      renderPallet("storage");
      number("X (m)", "0.7");
      fireEvent.change(
        screen.getByRole("textbox", { name: "Search storage locations" }),
        { target: { value: search } },
      );
      expect(
        screen
          .getByRole("region", { name: "Location options" })
          .querySelectorAll("button"),
      ).toHaveLength(1);
      const option = screen.getByRole("button", { name: /Other spot/ });
      expect(option).not.toHaveTextContent("Recommended");
      expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(
        0.7,
      );
      fireEvent.click(option);
      expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(
        0.5,
      );
      expect(option).toHaveAttribute("aria-pressed", "true");
      expect(callsFor("reserve")).toHaveLength(0);
    },
  );
  it("recovers an empty location search without losing the edited position", () => {
    renderPallet("storage");
    number("X (m)", "0.7");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search storage locations" }),
      { target: { value: "NOT-A-LOCATION" } },
    );
    expect(screen.getByText("No matching locations")).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(0.7);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      screen.getByRole("region", { name: "Location options" }),
    ).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(0.7);
    expect(callsFor("reserve")).toHaveLength(0);
  });
  it("edits immediately and rejects empty coordinates without silently using zero", () => {
    renderPallet("storage");
    expect(
      screen.queryByRole("button", { name: "Adjust position" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use this position" }),
    ).not.toBeInTheDocument();
    number("X (m)", "");
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(null);
    expect(
      screen.getByText("Enter valid X and Y coordinates, zero or greater."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeDisabled();
    expect(
      screen.queryByText("Dimensions fit inside the support"),
    ).not.toBeInTheDocument();
    number("X (m)", "0.3");
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeEnabled();
  });
  it("defaults to fixed surfaces, shows real dimensions and only includes stacking when requested", () => {
    const stack = {
      ...finishedGoodDestination,
      supportPalletId: "lower",
      supportCode: "LOWER",
      supportLabel: "LOWER",
      zMm: 1400,
    };
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: [finishedGoodDestination, stack],
            reasons: [],
          }),
    );
    renderPallet("storage");
    expect(
      screen.getByLabelText("Outer dimensions: length × width × height"),
    ).toHaveTextContent("1.2 m × 1 m × 1.4 m");
    expect(screen.getByText(/Previewing does not reserve space/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /LOWER/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Include pallet stacking" }),
    );
    expect(screen.getByRole("button", { name: /LOWER/ })).toBeVisible();
    expect(callsFor("reserve")).toHaveLength(0);
  });
  it("distinguishes failed recommendation loading from an empty result", () => {
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : { ok: false, requestId: "failed" },
    );
    renderPallet("storage");
    expect(screen.getByText("Could not load recommendations")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: currentDetail.pallet.code }),
    ).toHaveAttribute(
      "href",
      `/finished-goods/pallets/${currentDetail.pallet._id}`,
    );
    expect(
      screen.queryByRole("heading", { name: "No suitable space found" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      "small base",
      { widthMm: 600 },
      undefined,
      "The supporting base is too small",
    ],
    [
      "low ceiling",
      { heightMm: 100 },
      undefined,
      "Pallet exceeds the available height",
    ],
    [
      "level limit",
      {},
      "STACK_LEVELS_EXCEEDED",
      "This would exceed the configured number of stack levels",
    ],
  ] as const)(
    "keeps a rejected %s preview elevated and blocks confirmation",
    (_name, size, blockedReason, message) => {
      const top = {
        surface: {
          ...finishedGoodDestination.support,
          xMm: 200,
          yMm: 200,
          zMm: 1400,
          heightMm: 1600,
          ...size,
        },
        supportPalletId: "lower",
        supportCode: "LOWER",
        ...(blockedReason ? { blockedReason } : {}),
      };
      mocks.query.mockImplementation((name) =>
        name.endsWith(":getPallet")
          ? querySuccess(currentDetail)
          : querySuccess({
              candidates: [
                {
                  ...finishedGoodDestination,
                  previewSupports: [
                    { surface: finishedGoodDestination.support },
                    top,
                  ],
                },
              ],
              reasons: [],
            }),
      );
      renderPallet("storage");
      fireEvent.change(screen.getByRole("spinbutton", { name: "X (m)" }), {
        target: { value: "0.2" },
      });
      expect(
        screen.getByText(/Position: X 0.2 m · Y 0.2 m · Z 1.4 m/),
      ).toBeInTheDocument();
      expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Reserve this position" }),
      ).toBeDisabled();
      expect(callsFor("reserve")).toHaveLength(0);
    },
  );

  it.each(["BOX", "OTHER"] as const)(
    "keeps %s on the fixed surface even when pallet preview supports exist",
    (storageFormat) => {
      currentDetail = {
        ...currentDetail,
        pallet: { ...currentDetail.pallet, storageFormat },
      };
      const candidate = {
        ...finishedGoodDestination,
        previewSupports: [
          { surface: finishedGoodDestination.support },
          {
            surface: {
              ...finishedGoodDestination.support,
              zMm: 1400,
              heightMm: 1600,
            },
            supportPalletId: "lower",
          },
        ],
      };
      mocks.query.mockImplementation((name) =>
        name.endsWith(":getPallet")
          ? querySuccess(currentDetail)
          : querySuccess({ candidates: [candidate], reasons: [] }),
      );
      renderPallet("storage");
      number("X (m)", "0.3");
      expect(
        screen.getByText(/Position: X 0.3 m · Y 0.2 m · Z 0 m/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("spinbutton", { name: /Z/ }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.queryByText(/stack automatically/)).not.toBeInTheDocument();
      expect(
        screen.getByText(/Drag to adjust the position on the floor or rack/),
      ).toBeVisible();
    },
  );

  it("shows an invalid elevated preview even when there are no valid recommendations", () => {
    const candidate = {
      ...finishedGoodDestination,
      previewSupports: [
        { surface: finishedGoodDestination.support },
        {
          surface: {
            ...finishedGoodDestination.support,
            zMm: 2800,
            heightMm: 200,
          },
          supportPalletId: "lower",
        },
      ],
    };
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: [],
            previewCandidates: [candidate],
            reasons: ["NO_FREE_FOOTPRINT"],
          }),
    );
    renderPallet("storage");
    expect(
      screen.getByRole("heading", { name: "No suitable space found" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Recommended", { exact: true }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect unavailable areas" }),
    );
    number("X (m)", "0.3");
    expect(
      screen.getByText(/Position: X 0.3 m · Y 0.2 m · Z 2.8 m/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Pallet exceeds the available height/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeDisabled();
    expect(callsFor("reserve")).toHaveLength(0);
  });

  it("automatically raises an edited position onto a pallet and submits that support identity", async () => {
    const stack = {
      ...finishedGoodDestination,
      supportPalletId: "lower-pallet",
      supportCode: "LOWER-1",
      supportLabel: "LOWER-1",
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
    renderPallet("storage");
    fireEvent.change(screen.getByRole("spinbutton", { name: "X (m)" }), {
      target: { value: "0.3" },
    });
    expect(
      screen.getByText(/Position: X 0.3 m · Y 0.2 m · Z 1.4 m/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reserve this position" }),
    );
    await waitFor(() => expect(callsFor("reserve")).toHaveLength(1));
    expect(callsFor("reserve")[0]?.[1]).toMatchObject({
      supportPalletId: "lower-pallet",
    });
    expect(callsFor("reserve")[0]?.[1]).not.toHaveProperty("zMm");
  });

  it("requires measurement on a direct storage URL for an unmeasured pallet", () => {
    currentDetail = { ...measuredPalletDetail, pallet: finishedGoodPallet };
    renderPallet("storage");
    expect(
      screen.getByRole("link", { name: "Measure pallet" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/pallet-a/measure");
    expect(
      mocks.query.mock.calls.some(([name]) => name.endsWith(":recommend")),
    ).toBe(false);
  });

  it("shows no-fit reasons and recovery actions", () => {
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({ candidates: [], reasons: ["NO_ACTIVE_LOCATIONS"] }),
    );
    renderPallet("storage");
    expect(
      screen.getByRole("heading", { name: "No suitable space found" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "No active storage locations are available in this warehouse.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Edit measurements" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/pallet-a/measure");
    expect(screen.getByRole("link", { name: "Save for later" })).toBeVisible();
  });

  it("explains each distinct no-fit reason once", () => {
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: [],
            reasons: [
              "LOCATION_GEOMETRY_UNKNOWN",
              "STACK_LIMITS_REQUIRED",
              "UNMAPPED_A",
              "UNMAPPED_B",
            ],
          }),
    );
    renderPallet("storage");
    const items = within(
      screen
        .getByRole("heading", { name: "No suitable space found" })
        .closest("div")!,
    )
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "A location holds units without measured coordinates, so its free space is unknown. Measure or place those units, or choose another location.",
      "A pallet that could support this one has no stacking limits. Enable stacking and set its maximum levels to use its top.",
      "No valid position meets the current dimensions and storage constraints.",
    ]);
  });

  it.each(["en", "th"] as const)(
    "gives every emitted recommendation refusal its own %s explanation",
    (locale) => {
      const tr = (en: string, th: string) => (locale === "th" ? th : en);
      // Every reason convex/finishedGoods/workflow.ts recommend/recommendMove emits.
      const emitted = [
        "NOT_FOUND",
        "MEASUREMENTS_REQUIRED",
        "STORED_PALLET_REQUIRED",
        "LOCATION_GEOMETRY_UNKNOWN",
        "STORAGE_CONDITION_MISMATCH",
        "NO_SUPPORT_SURFACE",
        "STACK_PALLET_ONLY",
        "PALLET_SUPPORTING_STACK",
        "STACK_CYCLE",
        "STACK_SUPPORT_UNAVAILABLE",
        "STACK_SUPPORT_MOVING",
        "STACK_LIMITS_REQUIRED",
        "STACK_LEVELS_EXCEEDED",
        "STACK_SUPPORT_OCCUPIED",
        "HEIGHT_EXCEEDED",
        "NO_FREE_FOOTPRINT",
        "NO_ACTIVE_LOCATIONS",
      ];
      const fallback = recommendationReason("UNMAPPED", tr);
      const texts = recommendationReasons(emitted, tr);
      expect(texts).toHaveLength(emitted.length);
      expect(texts).not.toContain(fallback);
      // Equivalent unmapped codes collapse to one fallback line.
      expect(recommendationReasons(["UNMAPPED", "OTHER"], tr)).toEqual([
        fallback,
      ]);
    },
  );

  it("previews a local coordinate and reserves in one explicit action", async () => {
    renderPallet("storage");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Storage condition is not configured/),
    ).toBeVisible();
    number("X (m)", "0.2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText(/BLDG-A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/FG-1/).length).toBeGreaterThan(0);
    expect(mocks.write).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Reserve this position" }),
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-a",
      ),
    );
    expect(callsFor("reserve")[0]?.[1]).toMatchObject({
      zoneId: "zone-a",
      xMm: 200,
      yMm: 200,
      rotation: 0,
      expectedMeasurementUpdatedAt: 1000,
    });
    expect(callsFor("confirmStored")).toHaveLength(0);
  });

  it("restores an invalid position and camera after returning, then revalidates measurements", () => {
    const view = renderPallet("storage");
    number("X (m)", "1.5");
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    view.unmount();
    const restored = renderPallet("storage");
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(1.5);
    expect(screen.getByRole("button", { name: "2D plan" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeDisabled();
    restored.unmount();
    currentDetail = {
      ...measuredPalletDetail,
      pallet: {
        ...measuredPalletDetail.pallet,
        widthMm: 100,
        lengthMm: 100,
        updatedAt: 2000,
      },
    };
    renderPallet("storage");
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(1.5);
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeEnabled();
  });

  it("keeps the selected destination and draft visible when corrected dimensions make it preview-only", () => {
    const alternative = {
      ...finishedGoodDestination,
      zoneId: "zone-larger",
      locationName: "Larger location",
      zone: { ...finishedGoodDestination.zone, widthMm: 4000 },
      support: { ...finishedGoodDestination.support, widthMm: 4000 },
    };
    let corrected = false;
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: corrected
              ? [alternative]
              : [alternative, finishedGoodDestination],
            previewCandidates: corrected ? [finishedGoodDestination] : [],
            reasons: [],
          }),
    );
    const first = renderPallet("storage");
    fireEvent.click(screen.getByRole("button", { name: /FG-1/ }));
    number("X (m)", "0.6");
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    first.unmount();
    corrected = true;
    currentDetail = {
      ...measuredPalletDetail,
      pallet: {
        ...measuredPalletDetail.pallet,
        widthMm: 2500,
        updatedAt: 2000,
      },
    };
    renderPallet("storage");
    expect(screen.getByRole("button", { name: /FG-1/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(0.6);
    expect(screen.getByRole("button", { name: "2D plan" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Inspect unavailable areas" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "This position is not valid. Adjust it before continuing.",
      ),
    ).toBeVisible();
    expect(callsFor("reserve")).toHaveLength(0);
  });

  it("keeps the implicitly selected destination after editing it and recommendations reorder", () => {
    const alternative = {
      ...finishedGoodDestination,
      zoneId: "zone-b",
      locationName: "Second location",
      xMm: 500,
    };
    let reordered = false;
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: reordered
              ? [alternative, finishedGoodDestination]
              : [finishedGoodDestination, alternative],
            reasons: [],
          }),
    );
    const first = renderPallet("storage");
    // Editing the already selected recommendation must not require clicking its card first.
    number("X (m)", "0.6");
    first.unmount();
    reordered = true;
    renderPallet("storage");
    expect(screen.getByRole("button", { name: /FG-1/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Second location/ }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(0.6);
    expect(callsFor("reserve")).toHaveLength(0);
  });

  it("requires an explicit replacement when the selected destination disappears from both candidate lists", () => {
    const alternative = {
      ...finishedGoodDestination,
      zoneId: "zone-b",
      locationName: "Second location",
      xMm: 500,
    };
    let removed = false;
    mocks.query.mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(currentDetail)
        : querySuccess({
            candidates: removed
              ? [alternative]
              : [finishedGoodDestination, alternative],
            previewCandidates: [],
            reasons: [],
          }),
    );
    const first = renderPallet("storage");
    number("X (m)", "0.6");
    first.unmount();
    removed = true;
    renderPallet("storage");
    expect(
      screen.getByText(
        "The previous location is no longer available. Select another destination to continue.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("spinbutton", { name: "X (m)" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reserve this position" }),
    ).not.toBeInTheDocument();
    const other = screen.getByRole("button", { name: /Second location/ });
    expect(other).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(other);
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(0.5);
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeEnabled();
    expect(callsFor("reserve")).toHaveLength(0);
  });

  it("does not restore another actor's proposed coordinates", () => {
    const view = renderPallet("storage");
    number("X (m)", "0.7");
    view.unmount();
    mocks.actorId = "user-b";
    renderPallet("storage");
    expect(screen.getByRole("spinbutton", { name: "X (m)" })).toHaveValue(0.1);
  });

  it("blocks an invalid manually adjusted footprint and can reset it", () => {
    renderPallet("storage");
    number("X (m)", "1.5");
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "This position is not valid. Adjust it before continuing.",
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset to recommendation" }),
    );
    expect(
      screen.getByRole("button", { name: "Reserve this position" }),
    ).toBeEnabled();
  });

  it("keeps the proposed position visible on reservation conflict", async () => {
    mocks.write.mockResolvedValue(writeFailure("SPACE_OCCUPIED"));
    renderPallet("storage");
    fireEvent.click(
      screen.getByRole("button", { name: "Reserve this position" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /reserved this space/,
    );
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

describe("reserved destination and physical storage confirmation", () => {
  beforeEach(() => {
    currentDetail = reservedPalletDetail;
  });
  it("keeps storage confirmation disabled after a wrong destination", async () => {
    mocks.write.mockResolvedValue(writeFailure("DESTINATION_MISMATCH"));
    renderPallet();
    const dialog = screen.getByRole("region", {
      name: "Verify destination and placement",
    });
    expect(
      within(dialog).getByRole("button", { name: "Confirm stored" }),
    ).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Destination code"), {
      target: { value: "wrong-qr" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify entered code" }),
    );
    await waitFor(() => expect(callsFor("verifyDestination")).toHaveLength(1));
    expect(callsFor("verifyDestination")[0]?.[1]).toMatchObject({
      code: "wrong-qr",
      method: "MANUAL",
      palletId: "pallet-a",
    });
    await screen.findByRole("alert");
    expect(
      within(dialog).getByRole("button", { name: "Confirm stored" }),
    ).toBeDisabled();
    expect(callsFor("confirmStored")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
    expect(
      within(screen.getByRole("dialog")).queryByRole("alert"),
    ).not.toBeInTheDocument();
  });

  it("requires a separate physical confirmation after successful verification", async () => {
    const view = renderPallet();
    fireEvent.change(screen.getByLabelText("Destination code"), {
      target: { value: "ISAS:LOCATION:1:location-a" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify entered code" }),
    );
    await waitFor(() => expect(callsFor("verifyDestination")).toHaveLength(1));
    expect(callsFor("confirmStored")).toHaveLength(0);
    currentDetail = {
      ...reservedPalletDetail,
      destinationVerifiedForCurrentUser: true,
      placement: {
        ...reservedPalletDetail.placement!,
        verifiedAt: 2000,
        verificationMethod: "MANUAL",
      },
    };
    await act(async () => view.refresh());
    expect(
      screen.getByRole("button", { name: "Confirm stored" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm stored" }));
    await waitFor(() => expect(callsFor("confirmStored")).toHaveLength(1));
  });

  it("can keep a reservation or explicitly release it", async () => {
    renderPallet();
    fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
    expect(mocks.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep reservation" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
    fireEvent.click(screen.getByRole("button", { name: "Release space" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-a/storage",
      ),
    );
    expect(callsFor("cancelReservation")).toHaveLength(1);
  });

  it("restores server verification after refresh and provides stored navigation", () => {
    currentDetail = {
      ...reservedPalletDetail,
      pallet: { ...reservedPalletDetail.pallet, status: "STORED" },
      placement: {
        ...reservedPalletDetail.placement!,
        status: "STORED",
        verifiedAt: 2000,
        verificationMethod: "SCAN",
      },
    };
    renderPallet("storage");
    expect(
      screen.getByRole("heading", { name: "Stored successfully" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View storage layout" }),
    ).toHaveAttribute(
      "href",
      "/master-data/storage-layouts/building-a/floors/4#storage-zone-zone-a",
    );
    expect(
      screen.getByRole("link", { name: "Product and batches" }),
    ).toHaveAttribute("href", "/finished-goods/products/product-a");
    expect(
      screen.queryByRole("button", { name: "Cancel reservation" }),
    ).not.toBeInTheDocument();
  });
});

describe("read-only pallet access", () => {
  beforeEach(() => {
    mocks.canManage = false;
  });
  function noEnabledButton(name: string) {
    const button = screen.queryByRole("button", { name });
    if (button) expect(button).toBeDisabled();
  }
  it.each(["measure", "storage"] as const)(
    "keeps a direct %s URL readable without mutation controls",
    (view) => {
      renderPallet(view);
      expect(screen.getByText(/FG-001 · Packaging cartons/)).toBeVisible();
      noEnabledButton("Save and find storage");
      noEnabledButton("Save and exit");
      noEnabledButton("Reserve this position");
      noEnabledButton("Reserve this position");
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
  it("does not allow a read-only operator to verify, release or confirm a reservation", () => {
    currentDetail = reservedPalletDetail;
    renderPallet();
    expect(
      screen.getByRole("heading", { name: "Move pallet to storage" }),
    ).toBeVisible();
    noEnabledButton("Scan destination QR");
    noEnabledButton("Cancel reservation");
    noEnabledButton("Confirm stored");
    expect(
      screen.queryByRole("link", { name: "Change storage position" }),
    ).not.toBeInTheDocument();
  });
  it("shows a stored location without offering another pallet", () => {
    currentDetail = {
      ...reservedPalletDetail,
      pallet: { ...reservedPalletDetail.pallet, status: "STORED" },
    };
    renderPallet();
    expect(
      screen.getByRole("link", { name: "View storage layout" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Product and batches" }),
    ).not.toBeInTheDocument();
  });
});

describe("operator-specific destination verification", () => {
  it("requires the current operator to verify even if another operator already scanned", () => {
    currentDetail = {
      ...reservedPalletDetail,
      destinationVerifiedForCurrentUser: false,
      placement: {
        ...reservedPalletDetail.placement!,
        verifiedAt: 2000,
        verifiedByUserId: "other-operator",
        verificationMethod: "SCAN",
      },
    };
    renderPallet();
    expect(screen.getByLabelText("Destination code")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Confirm stored" }),
    ).toBeDisabled();
    expect(screen.queryByText("Destination verified")).not.toBeInTheDocument();
  });
});

describe("measurement draft privacy", () => {
  it("does not show another actor's unsaved dimensions after identity changes", () => {
    const view = renderPallet("measure");
    number("Length (m)", "1.9");
    mocks.actorId = "user-b";
    view.refresh();
    expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
      1.2,
    );
    number("Length (m)", "1.5");
    mocks.actorId = "user-a";
    view.refresh();
    expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
      1.9,
    );
  });
  it("waits for the signed-in actor before reading measurement drafts", () => {
    mocks.authLoaded = false;
    renderPallet("measure");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(
      screen.queryByRole("spinbutton", { name: "Length (m)" }),
    ).not.toBeInTheDocument();
  });
});

it("can save measurements when browser recovery storage is blocked", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
  const remove = vi
    .spyOn(Storage.prototype, "removeItem")
    .mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
  try {
    renderPallet("measure");
    number("Length (m)", "1.5");
    fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-a",
      ),
    );
    expect(callsFor("saveMeasurement")[0]?.[1]).toMatchObject({
      lengthMm: 1500,
    });
  } finally {
    read.mockRestore();
    write.mockRestore();
    remove.mockRestore();
  }
});

it("guides stacked reservations to verify both pallet identities", () => {
  currentDetail = {
    ...reservedPalletDetail,
    placement: { ...reservedPalletDetail.placement!, supportPalletId: "lower" },
    supportPallet: {
      ...measuredPalletDetail.pallet,
      _id: "lower",
      code: "P-LOWER",
      status: "STORED",
    },
  };
  renderPallet("detail");
  expect(
    screen.getByRole("textbox", { name: "Supporting pallet code" }),
  ).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "Upper pallet code or QR" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Confirm stored" })).toBeDisabled();
});
it("does not offer pallet stacking for a stored box", () => {
  currentDetail = {
    ...reservedPalletDetail,
    pallet: {
      ...reservedPalletDetail.pallet,
      status: "STORED",
      storageFormat: "BOX",
    },
    placement: { ...reservedPalletDetail.placement!, status: "STORED" },
  };
  renderPallet("detail");
  expect(
    screen.queryByRole("link", { name: "Stack on top" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Move box" })).toBeVisible();
});

it("reads saved location-only group order without inventing a geometric scene", () => {
  currentDetail = {
    ...reservedPalletDetail,
    pallet: { ...reservedPalletDetail.pallet, status: "STORED" },
    destination: null,
    placement: {
      _id: "scan-placement",
      _creationTime: 1,
      orgId: "org-a",
      warehouseId: "warehouse-a",
      palletId: "pallet-a",
      buildingId: "building-a",
      floorId: "floor-a",
      zoneId: "zone-a",
      locationId: "location-a",
      mode: "LOCATION_ONLY",
      assignmentId: "assignment-a",
      sequence: 1,
      status: "STORED",
      positionCode: "LOC-1",
      qrValue: "LOC-1",
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: "user-a",
      updatedByUserId: "user-a",
    },
  };
  mocks.query.mockImplementation((name) =>
    name.endsWith(":getScanAssignment")
      ? querySuccess({
          location: { code: "LOC-1", name: "Packing zone" },
          sameSize: false,
          orderedUnits: [
            {
              unitId: "pallet-a",
              code: "A",
              productName: "Item A",
              sequence: 1,
              fillPercent: 75,
            },
            {
              unitId: "pallet-b",
              code: "B",
              productName: "Item B",
              sequence: 2,
              fillPercent: 50,
            },
          ],
        })
      : querySuccess(currentDetail),
  );
  renderPallet();
  expect(screen.getByText("LOC-1 · Packing zone")).toBeVisible();
  // The breadcrumb trail is also a list; the saved group order is the other one.
  const group = screen
    .getAllByRole("list")
    .find((list) => !list.closest("nav"))!;
  expect(within(group).getAllByRole("listitem")[0]).toHaveTextContent(
    "1 · TopAItem A75% full",
  );
  expect(within(group).getAllByRole("listitem")[1]).toHaveTextContent(
    "2 · BottomBItem B50% full",
  );
  expect(
    screen.queryByRole("link", { name: /Move pallet/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Destination unavailable")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "3D view" }),
  ).not.toBeInTheDocument();
});

describe("stale measurement save lifecycle", () => {
  it("does not navigate or clear the draft when the measurement save resolves after unmount", async () => {
    const draftKey = "fg-measure:user-a:warehouse-a:pallet-a";
    let resolveWrite!: (value: ReturnType<typeof success>) => void;
    mocks.write.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const view = renderPallet("measure");
    fireEvent.change(screen.getByRole("textbox", { name: "Lot (optional)" }), {
      target: { value: "LOT-9" },
    });
    expect(localStorage.getItem(draftKey)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
    await waitFor(() => expect(callsFor("saveMeasurement")).toHaveLength(1));
    view.unmount();
    await act(async () => {
      resolveWrite(success("pallet-a"));
      await Promise.resolve();
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(localStorage.getItem(draftKey)).not.toBeNull();
  });
});

import { trackAppHistory } from "@/lib/browser/appHistory";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
let stopPalletTracking: (() => void) | undefined;
afterEach(() => {
  stopPalletTracking?.();
  stopPalletTracking = undefined;
});
function ownedPallet(view: "detail" | "measure" = "detail") {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/finished-goods?search=box#origin",
  );
  stopPalletTracking = trackAppHistory();
  window.history.pushState(
    {},
    "",
    `/th/finished-goods/pallets/pallet-a${view === "measure" ? "/measure" : ""}?kept=yes#position`,
  );
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={messagesFor("en")}
      timeZone="Asia/Bangkok"
    >
      <NavigationGuardProvider>
        <PalletScreen palletId="pallet-a" view={view} />
      </NavigationGuardProvider>
    </NextIntlClientProvider>,
  );
}
async function palletBack() {
  await act(async () => {
    window.history.back();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}
it("measurement native Back retains the dirty draft and discard restores the actual catalogue origin", async () => {
  ownedPallet("measure");
  number("Length (m)", "1.3");
  await palletBack();
  expect(
    await screen.findByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
    1.3,
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("dialog", { name: "Save changes before leaving?" });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/th/finished-goods?search=box#origin"),
  );
});
it("reservation explicit Close consumes its dialog before the next native Back", async () => {
  currentDetail = reservedPalletDetail;
  ownedPallet();
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Release this reserved space?",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(
      [...new URLSearchParams(window.location.search).keys()].some((key) =>
        key.startsWith("overlay"),
      ),
    ).toBe(false),
  );
  await palletBack();
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/th/finished-goods?search=box#origin"),
  );
  expect(mocks.write).not.toHaveBeenCalled();
});
it("pending reservation release blocks native Back and success consumes its modal and task entry", async () => {
  currentDetail = reservedPalletDetail;
  let resolveRelease!: () => void;
  mocks.write.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRelease = () => resolve(success("pallet-a"));
      }),
  );
  ownedPallet();
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Release this reserved space?",
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Release space" }),
  );
  await waitFor(() => expect(callsFor("cancelReservation")).toHaveLength(1));
  await palletBack();
  expect(window.location.pathname).toBe("/th/finished-goods/pallets/pallet-a");
  expect(
    screen.getByRole("dialog", { name: "Release this reserved space?" }),
  ).toBeVisible();
  await act(async () => resolveRelease());
  await waitFor(() =>
    expect(window.location.pathname).toBe(
      "/th/finished-goods/pallets/pallet-a/storage",
    ),
  );
  expect(window.history.state.appNavigationIndex).toBe(1);
  await palletBack();
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/th/finished-goods?search=box#origin"),
  );
});

it("retains the loaded measurement baseline across live updates and reloads only after explicit discard", async () => {
  const baseline = currentDetail.pallet.updatedAt;
  const view = renderPallet("measure");
  number("Width (m)", "1.75");
  currentDetail = {
    ...currentDetail,
    pallet: { ...currentDetail.pallet, widthMm: 2000, updatedAt: baseline + 1 },
  };
  view.refresh();
  expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
    1.75,
  );
  mocks.write.mockResolvedValueOnce(writeFailure("VERSION_CONFLICT"));
  fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
  await waitFor(() => expect(callsFor("saveMeasurement")).toHaveLength(1));
  expect(callsFor("saveMeasurement")[0]?.[1]).toEqual(
    expect.objectContaining({
      expectedMeasurementUpdatedAt: baseline,
      widthMm: 1750,
    }),
  );
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Discard draft and reload saved measurements",
    }),
  );
  expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(2);
  fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
  await waitFor(() => expect(callsFor("saveMeasurement")).toHaveLength(2));
  expect(callsFor("saveMeasurement")[1]?.[1]).toEqual(
    expect.objectContaining({
      expectedMeasurementUpdatedAt: baseline + 1,
      widthMm: 2000,
    }),
  );
});

it("retains a stale measurement draft baseline across remount", async () => {
  const baseline = currentDetail.pallet.updatedAt;
  const view = renderPallet("measure");
  number("Width (m)", "1.75");
  view.unmount();
  currentDetail = {
    ...currentDetail,
    pallet: { ...currentDetail.pallet, widthMm: 2000, updatedAt: baseline + 1 },
  };
  renderPallet("measure");
  fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
  await waitFor(() => expect(callsFor("saveMeasurement")).toHaveLength(1));
  expect(callsFor("saveMeasurement")[0]?.[1]).toEqual(
    expect.objectContaining({
      expectedMeasurementUpdatedAt: baseline,
      widthMm: 1750,
    }),
  );
});

it("preserves old measurement drafts without assigning the current server baseline", async () => {
  localStorage.setItem(
    "fg-measure:user-a:warehouse-a:pallet-a",
    JSON.stringify({
      quantity: "500",
      lot: "Old",
      length: "1",
      width: "1.75",
      height: "1",
      weight: "",
      unit: "m",
    }),
  );
  renderPallet("measure");
  expect(screen.getByRole("spinbutton", { name: "Width (m)" })).toHaveValue(
    1.75,
  );
  expect(
    screen.getByRole("button", {
      name: "Discard draft and reload saved measurements",
    }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
  await waitFor(() => expect(callsFor("saveMeasurement")).toHaveLength(1));
  expect(callsFor("saveMeasurement")[0]?.[1]).toEqual(
    expect.objectContaining({ expectedMeasurementUpdatedAt: -1 }),
  );
});

it("refuses fractional discrete measurement quantities before calling the server", async () => {
  renderPallet("measure");
  number("Actual quantity", "1.5");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Save and exit" }));
  await screen.findByRole("alert");
  expect(callsFor("saveMeasurement")).toHaveLength(0);
  expect(
    screen.getByRole("spinbutton", { name: "Actual quantity" }),
  ).toHaveAttribute("step", "1");
});
