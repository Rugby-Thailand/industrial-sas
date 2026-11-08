import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { messagesFor } from "@/i18n/messages";
import { StorageZonesPanel } from "./StorageZonesPanel";

vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/i18n/navigation", () => ({
  Link: "a",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
const text = messagesFor("en").StorageLayouts;
beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

function openEditor(
  size = 10000,
  reservedBlocks: Parameters<
    typeof StorageZonesPanel
  >[0]["reservedBlocks"] = [],
) {
  renderWithIntl(
    <StorageZonesPanel
      warehouseId="warehouse"
      buildingId="building"
      floorNumber={1}
      floorWidthMm={size}
      floorDepthMm={size}
      floorHeightMm={3000}
      zones={[]}
      reservedBlocks={reservedBlocks}
    />,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getByRole("button", { name: text.addStorageZone }));
  return within(screen.getByRole("dialog"));
}

it.each(["", "2.0005", "2e0"])(
  "real number input %j must not show a success preview while Save is disabled",
  (x) => {
    const dialog = openEditor();
    const input = dialog.getByRole("spinbutton", { name: text.x });
    fireEvent.change(input, { target: { value: x } });
    expect((input as HTMLInputElement).value).toBe(x);
    expect(dialog.getByTestId("zone-placement-status")).toHaveTextContent(
      text.layoutActions.placement.incomplete,
    );
    expect(
      dialog.getByRole("button", { name: text.createStorageZone }),
    ).toBeDisabled();
    expect(dialog.queryByText(text.zoneFitsFloor)).not.toBeInTheDocument();
  },
);

it("new spot and Find free space must find an origin that the same editor accepts around a column", () => {
  const dialog = openEditor(2000, [
    {
      id: "column",
      label: "Column",
      xMm: 500,
      yMm: 500,
      widthMm: 1000,
      depthMm: 1000,
    },
  ]);
  const x = dialog.getByRole("spinbutton", {
    name: text.x,
  }) as HTMLInputElement;
  const y = dialog.getByRole("spinbutton", {
    name: text.y,
  }) as HTMLInputElement;
  const initial = { x: x.value, y: y.value };
  fireEvent.change(x, { target: { value: "0" } });
  fireEvent.change(y, { target: { value: "0" } });
  expect(
    dialog.getByRole("button", { name: text.createStorageZone }),
  ).toBeEnabled();
  fireEvent.click(
    dialog.getByRole("button", {
      name: text.layoutActions.placement.findSpace,
    }),
  );
  expect({
    initial,
    noRoom:
      dialog.queryByText(text.layoutActions.placement.noRoomHelp) !== null,
  }).toEqual({ initial: { x: "0", y: "0" }, noRoom: false });
});
