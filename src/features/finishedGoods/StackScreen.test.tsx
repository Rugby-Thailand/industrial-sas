import { renderWithIntl } from "@tests/fixtures/intl-render";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";
import { messagesFor } from "@/i18n/messages";
import { axe } from "jest-axe";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import type { fgRefs } from "@/lib/convex/finishedGoodsApi";
import type { RefValue } from "@/lib/convex/clientRef";
import type { writeSuccess } from "@tests/fixtures/finished-goods-ui";
import { openSelect } from "@tests/fixtures/select-control";
import { clearCursorPositions } from "@/hooks/useCursorPagination";

const mocks = vi.hoisted(() => ({
  canManage: true,
  authLoaded: true,
  actorId: "user-a",
  push: vi.fn(),
  replace: vi.fn(),
  query: vi.fn<(name: string, args: Record<string, unknown>) => unknown>(),
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
    args === "skip"
      ? undefined
      : mocks.query(getFunctionName(ref), args as Record<string, unknown>),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

import {
  finishedGoodsWorkspace,
  finishedGoodDestination,
  measuredPalletDetail,
  querySuccess,
  writeFailure as failure,
  writeSuccess as success,
} from "@tests/fixtures/finished-goods-ui";
import { StackScreen } from "./StackScreen";
type Choice = NonNullable<RefValue<typeof fgRefs.stackPreview>>["upper"] & {};
let data: Omit<NonNullable<RefValue<typeof fgRefs.stackPreview>>, "upper"> & {
  pallets: Choice[];
};
/** Choices are paged separately; the preview resolves the chosen ID. */
function respond(name: string, args: Record<string, unknown>) {
  if (name.endsWith(":stackChoices"))
    return querySuccess({
      status: "ready",
      items: data.pallets,
      isDone: true,
      continueCursor: "",
      scanned: data.pallets.length,
    });
  if (name.endsWith(":stackPreview")) {
    const { pallets, ...preview } = data;
    const upper = pallets.find((p) => p._id === args["upperPalletId"]) ?? null;
    return querySuccess({
      ...preview,
      upper,
      candidate: upper ? preview.candidate : null,
    });
  }
  return querySuccess(data);
}
function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
      <StackScreen palletId="lower" />
    </NextIntlClientProvider>,
  );
}
function chooseUpperPallet(label = "2. Upper pallet") {
  const option = within(openSelect(label)).getByRole("option", {
    name: /^P-002/,
  });
  fireEvent.keyDown(option, { key: "Enter" });
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Choice pages remembered by an earlier test must not leak into the next.
  clearCursorPositions();
  mocks.canManage = true;
  const lower = {
    ...measuredPalletDetail.pallet,
    _id: "lower",
    code: "P-001",
    status: "STORED" as const,
    weightKg: 100,
    stackable: true,
    maxStackLevels: 2,
  };
  const upper = {
    ...measuredPalletDetail.pallet,
    _id: "upper",
    code: "P-002",
    weightKg: 150,
  };
  data = {
    lower,
    lowerSettingsLocked: false,
    upperSettingsLocked: false,
    pallets: [upper],
    children: [],
    error: null,
    candidate: {
      ...finishedGoodDestination,
      supportPalletId: "lower",
      zMm: 1400,
      support: {
        ...finishedGoodDestination.support,
        zMm: 1400,
        heightMm: 1600,
      },
    },
  };
  mocks.query.mockImplementation(respond);
  mocks.write.mockResolvedValue(success("placement-stack"));
});
it("keeps reservation disabled until an upper pallet is chosen", () => {
  data = { ...data, candidate: null };
  mount();
  expect(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  ).toBeDisabled();
  expect(
    screen.getByText("Choose an upper pallet to preview its exact position."),
  ).toBeVisible();
});
it("reserves using explicit supporting pallet identity and server-derived preview coordinates", async () => {
  mount();
  chooseUpperPallet();
  fireEvent.click(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  );
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/workflow:reserve",
      expect.objectContaining({ palletId: "upper", supportPalletId: "lower" }),
    ),
  );
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith("/finished-goods/pallets/upper"),
  );
});
it("uses the existing move workflow for a stored upper pallet", async () => {
  data = {
    ...data,
    pallets: data.pallets.map((p) => ({
      ...p,
      status: "STORED",
      placementId: "old-position",
    })),
  };
  mount();
  chooseUpperPallet();
  fireEvent.click(
    screen.getByRole("button", { name: "Reserve stack and prepare move" }),
  );
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/workflow:reserveMove",
      expect.objectContaining({
        palletId: "upper",
        supportPalletId: "lower",
        expectedSourcePlacementId: "old-position",
      }),
    ),
  );
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith(
      "/finished-goods/pallets/upper/move",
    ),
  );
});
it("shows level-limit failures and prevents confirmation", () => {
  data = { ...data, error: "STACK_LEVELS_EXCEEDED" };
  mount();
  chooseUpperPallet();
  expect(
    screen.getByText(
      "This would exceed the configured number of stack levels.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  ).toBeDisabled();
});
it("shows a useful empty state", () => {
  data = { ...data, pallets: [], candidate: null };
  mount();
  expect(
    screen.getByText(
      "No measured pallets are available. Create and measure a pallet first.",
    ),
  ).toBeVisible();
});
it("viewers cannot save limits or reserve a stack", () => {
  mocks.canManage = false;
  mount();
  chooseUpperPallet();
  expect(
    screen.queryByRole("button", { name: "Save stacking limits" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  ).toBeDisabled();
});
it("shows recoverable mutation failures", async () => {
  mocks.write.mockRejectedValue(new Error("STACK_SUPPORT_MOVING"));
  mount();
  chooseUpperPallet();
  fireEvent.click(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  );
  expect(
    await screen.findByText(
      "The supporting pallet has an active move. Finish or cancel that move first.",
    ),
  ).toBeVisible();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});
it("requires saving edited limits before reserving", () => {
  mount();
  chooseUpperPallet();
  fireEvent.change(
    screen.getAllByRole("spinbutton", {
      name: "Maximum levels, including this pallet",
    })[0]!,
    { target: { value: "3" } },
  );
  expect(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("combobox", { name: "2. Upper pallet" }),
  ).toBeDisabled();
  expect(
    screen.getByText("Save the edited stacking limits before reserving."),
  ).toBeVisible();
});

it.each(["en", "th"])(
  "keeps stacking controls accessible in %s",
  async (locale) => {
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={messagesFor(locale)}>
        <StackScreen palletId="lower" />
      </NextIntlClientProvider>,
    );
    chooseUpperPallet(locale === "th" ? "2. พาเลทด้านบน" : "2. Upper pallet");
    expect(await axe(container)).toHaveNoViolations();
  },
);

it("saves only stacking limits without weight/load configuration", async () => {
  mount();
  expect(screen.queryByLabelText(/weight|load/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save stacking limits" }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/workflow:saveStackingLimits",
      expect.objectContaining({ stackable: true, maxStackLevels: 2 }),
    ),
  );
  const args = mocks.write.mock.calls[0]![1] as Record<string, unknown>;
  expect(args).not.toHaveProperty("weightKg");
  expect(args).not.toHaveProperty("maxAboveLoadKg");
});

it("ignores a stacking reservation that resolves after unmount", async () => {
  let resolveReserve: () => void = () => {};
  mocks.write.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveReserve = () => resolve(success("placement-stack"));
      }),
  );
  const view = mount();
  chooseUpperPallet();
  fireEvent.click(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  );
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  // The pending request id is persisted before the await; capture that state.
  const persisted = localStorage.length;
  view.unmount();
  resolveReserve();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  // A reservation that settles after unmount must not navigate nor clear the
  // persisted request id (which would otherwise drop idempotent replay).
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(persisted);
});

it("pages upper pallet choices and keeps the chosen pallet selectable", async () => {
  const third = { ...data.pallets[0]!, _id: "third", code: "P-003" };
  const calls: Record<string, unknown>[] = [];
  mocks.query.mockImplementation((name, args) => {
    if (!name.endsWith(":stackChoices")) {
      const { pallets, ...preview } = data;
      const upper =
        [...pallets, third].find((p) => p._id === args["upperPalletId"]) ??
        null;
      return name.endsWith(":stackPreview")
        ? querySuccess({ ...preview, upper })
        : undefined;
    }
    calls.push(args);
    const second = args["cursor"] === "choices-2";
    return querySuccess({
      status: "ready",
      items: second ? [third] : data.pallets,
      isDone: second,
      continueCursor: second ? "" : "choices-2",
      scanned: 1,
    });
  });
  mount();
  chooseUpperPallet();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(calls.at(-1)).toMatchObject({ cursor: "choices-2", pageSize: 20 });
  // The chosen pallet is off this page but remains the reserved choice.
  expect(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  ).toBeEnabled();
  const select = openSelect("2. Upper pallet");
  expect(
    within(select).getByRole("option", { name: /^P-002/ }),
  ).toBeInTheDocument();
  expect(
    within(select).getByRole("option", { name: /^P-003/ }),
  ).toBeInTheDocument();
});

it("searches eligible choices on the server after typing settles", async () => {
  const calls: Record<string, unknown>[] = [];
  mocks.query.mockImplementation((name, args) => {
    if (name.endsWith(":stackChoices")) calls.push(args);
    return respond(name, args);
  });
  mount();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search upper pallets by code" }),
    { target: { value: "p-00" } },
  );
  expect(screen.getByText("Finding eligible pallets…")).toBeVisible();
  await waitFor(() =>
    expect(calls.at(-1)).toMatchObject({ search: "p-00", cursor: null }),
  );
  expect(calls.some((args) => args["search"] === "p-0")).toBe(false);
});

it("retries refused stack choices with a new subscription identity", async () => {
  const calls: Record<string, unknown>[] = [];
  mocks.query.mockImplementation((name, args) => {
    if (!name.endsWith(":stackChoices")) return respond(name, args);
    calls.push(args);
    // Depends on arguments only, like a Convex subscription.
    return args["attempt"] === 1
      ? respond(name, args)
      : querySuccess({
          status: "reset",
          items: [],
          isDone: true,
          continueCursor: "",
          scanned: 0,
        });
  });
  mount();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Pallet choices could not be loaded.",
  );
  expect(new Set(calls.map((args) => JSON.stringify(args))).size).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(calls.at(-1)).toMatchObject({ attempt: 1 }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  chooseUpperPallet();
});

it("stops following a stack choice scan that makes no progress", async () => {
  const calls: Record<string, unknown>[] = [];
  mocks.query.mockImplementation((name, args) => {
    if (!name.endsWith(":stackChoices")) return respond(name, args);
    calls.push(args);
    return querySuccess({
      status: "scanning",
      items: [],
      isDone: false,
      continueCursor: "",
      scanCursor: "stuck",
      scanned: 100,
    });
  });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Pallet choices could not be loaded.",
  );
  expect(
    new Set(calls.map((args) => args["scanCursor"])).size,
  ).toBeLessThanOrEqual(2);
});

it("guards unsent stack limits and clears the guard after values are reverted", async () => {
  renderWithIntl(
    <NavigationGuardProvider>
      <StackScreen palletId="lower" />
    </NavigationGuardProvider>,
    { locale: "en", workspace: false },
  );
  const checkbox = screen.getByRole("checkbox", {
    name: "May support another pallet",
  }) as HTMLInputElement;
  const initial = checkbox.checked;
  fireEvent.click(checkbox);
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(
    screen.getByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(checkbox.checked).toBe(!initial);
  fireEvent.click(checkbox);
  act(() => guardedNavigate(leave));
  await waitFor(() => expect(leave).toHaveBeenCalledOnce());
});

const levelsField = () =>
  screen.getByRole("spinbutton", {
    name: "Maximum levels, including this pallet",
  });
function rerenderWithLiveLevels(
  view: ReturnType<typeof mount>,
  maxStackLevels: number,
) {
  data = { ...data, lower: { ...data.lower, maxStackLevels } };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
      <StackScreen palletId="lower" />
    </NextIntlClientProvider>,
  );
}
const savedLimits = () =>
  mocks.write.mock.calls
    .filter(([name]) => name === "finishedGoods/workflow:saveStackingLimits")
    .map(([, args]) => args as Record<string, unknown>);

it("refreshes clean stacking limits from live settings and saves against them", async () => {
  const view = mount();
  expect(levelsField()).toHaveValue(2);
  // Another operator saves 5 while this form is untouched.
  rerenderWithLiveLevels(view, 5);
  expect(levelsField()).toHaveValue(5);
  fireEvent.click(screen.getByRole("button", { name: "Save stacking limits" }));
  await waitFor(() => expect(savedLimits()).toHaveLength(1));
  expect(savedLimits()[0]).toMatchObject({
    stackable: true,
    maxStackLevels: 5,
    expectedStackable: true,
    expectedMaxStackLevels: 5,
  });
});

it("refreshes deferred live limits when the operator restores a dirty field to its loaded value", () => {
  const view = mount();
  fireEvent.change(levelsField(), { target: { value: "3" } });
  rerenderWithLiveLevels(view, 5);
  expect(levelsField()).toHaveValue(3);
  fireEvent.change(levelsField(), { target: { value: "2" } });
  expect(levelsField()).toHaveValue(5);
});

it("refreshes deferred live limits after a clean save finishes", async () => {
  let finish!: (value: ReturnType<typeof success>) => void;
  mocks.write.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Save stacking limits" }));
  await waitFor(() => expect(savedLimits()).toHaveLength(1));
  rerenderWithLiveLevels(view, 5);
  expect(levelsField()).toHaveValue(2);
  await act(async () => {
    finish(success("lower"));
  });
  await waitFor(() => expect(levelsField()).toBeEnabled());
  expect(levelsField()).toHaveValue(5);
});

it("keeps its own saved limits until the live subscription acknowledges them", async () => {
  mocks.write.mockResolvedValue(success("lower"));
  const view = mount();
  fireEvent.change(levelsField(), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save stacking limits" }));
  await screen.findByText("Limits saved");
  // The query still has 2: it must not revert the successful local save.
  expect(levelsField()).toHaveValue(3);
  rerenderWithLiveLevels(view, 3);
  expect(levelsField()).toHaveValue(3);
  expect(screen.getByText("Limits saved")).toBeVisible();
});

it("keeps a dirty stacking draft over live changes and reloads only after a stale refusal", async () => {
  mocks.write.mockResolvedValue(failure("STACK_SETTINGS_STALE"));
  const view = mount();
  fireEvent.change(levelsField(), { target: { value: "3" } });
  rerenderWithLiveLevels(view, 5);
  expect(levelsField()).toHaveValue(3);
  fireEvent.click(screen.getByRole("button", { name: "Save stacking limits" }));
  const alert = await screen.findByRole("alert");
  // The save carried the loaded baseline, not the newer live value.
  expect(savedLimits()[0]).toMatchObject({
    maxStackLevels: 3,
    expectedStackable: true,
    expectedMaxStackLevels: 2,
  });
  expect(alert).toHaveTextContent(
    "Stacking limits changed in another session. Your entry is kept. Load the current limits, then make your change again.",
  );
  expect(levelsField()).toHaveValue(3);
  expect(
    screen.getByText("Save the edited stacking limits before reserving."),
  ).toBeVisible();
  mocks.write.mockResolvedValue(success("lower"));
  fireEvent.click(
    within(alert).getByRole("button", { name: "Load current limits" }),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(levelsField()).toHaveValue(5);
  expect(
    screen.queryByText("Save the edited stacking limits before reserving."),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save stacking limits" }));
  await waitFor(() => expect(savedLimits()).toHaveLength(2));
  expect(savedLimits()[1]).toMatchObject({
    maxStackLevels: 5,
    expectedMaxStackLevels: 5,
  });
  expect(savedLimits()[1]!["requestId"]).not.toBe(
    savedLimits()[0]!["requestId"],
  );
});

it("sends an absent maximum as the baseline for a pallet that was not stackable", async () => {
  // A pallet that was never configured has no saved maximum.
  const { maxStackLevels: _saved, ...lower } = data.lower;
  data = { ...data, lower: { ...lower, stackable: false } };
  mount();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "May support another pallet" }),
  );
  fireEvent.change(levelsField(), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Save stacking limits" }));
  await waitFor(() => expect(savedLimits()).toHaveLength(1));
  expect(savedLimits()[0]).toMatchObject({
    stackable: true,
    maxStackLevels: 4,
    expectedStackable: false,
  });
  expect(savedLimits()[0]).not.toHaveProperty("expectedMaxStackLevels");
});
