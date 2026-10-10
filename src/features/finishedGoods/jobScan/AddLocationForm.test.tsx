import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  querySuccess,
  writeSuccess,
  writeFailure,
} from "@tests/fixtures/finished-goods-ui";
import { AddLocationForm } from "./AddLocationForm";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  resolve: vi.fn(),
  noBuildings: false,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.create,
  useConvex: () => ({ query: mocks.resolve }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip"
      ? undefined
      : getFunctionName(ref).endsWith(":options")
        ? querySuccess({
            buildings: mocks.noBuildings
              ? []
              : [
                  {
                    id: "building-a",
                    code: "A",
                    name: "Building A",
                    floors: [{ id: "floor-1", number: 1 }],
                  },
                  {
                    id: "building-b",
                    code: "B",
                    name: "Building B",
                    floors: [{ id: "floor-2", number: 2 }],
                  },
                ],
          })
        : querySuccess({
            ok: true,
            location: {
              locationId: "existing",
              code: "DOCK-NEW",
              buildingName: "Building A",
            },
          }),
}));
beforeEach(() => {
  mocks.create.mockReset();
  mocks.resolve.mockReset();
  mocks.noBuildings = false;
  mocks.create.mockResolvedValue(writeSuccess("named-a"));
  mocks.resolve.mockResolvedValue(
    querySuccess({
      ok: true,
      location: {
        locationId: "named-a",
        code: "DOCK-NEW",
        name: "New dock",
        buildingName: "Building A",
        buildingId: "building-a",
        layoutPending: true,
      },
    }),
  );
});
function renderForm() {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const view = renderWithIntl(
    <AddLocationForm
      warehouseId="warehouse-a"
      initialCode="DOCK-NEW"
      onPick={onPick}
      onCancel={onCancel}
    />,
    { locale: "en", preserveProviders: true },
  );
  return { ...view, onPick, onCancel };
}
async function select(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: option }));
}
it("requires a building, clears an incompatible floor and selects the created canonical location", async () => {
  const { onPick, container } = renderForm();
  expect(screen.getByRole("textbox", { name: "Location code" })).toHaveFocus();
  expect(
    screen.getByRole("button", { name: "Create and use location" }),
  ).toBeDisabled();
  await select("Building", "A · Building A");
  await select("Floor (optional)", "Floor 1");
  await select("Building", "B · Building B");
  expect(
    screen.getByRole("combobox", { name: "Floor (optional)" }),
  ).toHaveTextContent("Set floor later");
  fireEvent.click(
    screen.getByRole("button", { name: "Create and use location" }),
  );
  await screen.findByRole("button", { name: "Create and use location" });
  await act(async () => {});
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ code: "DOCK-NEW", buildingId: "building-b" }),
  );
  expect(mocks.create.mock.calls[0]![0]).not.toHaveProperty("floorId");
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ locationId: "named-a", text: "DOCK-NEW" }),
  );
  expect(await axe(container)).toHaveNoViolations();
});
it("reuses the request after a lost response and offers a concurrent existing registration", async () => {
  mocks.create.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
  const { onPick } = renderForm();
  await select("Building", "A · Building A");
  fireEvent.click(
    screen.getByRole("button", { name: "Create and use location" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Create and use location" }),
  );
  await act(async () => {});
  expect(mocks.create.mock.calls[0]![0].requestId).toBe(
    mocks.create.mock.calls[1]![0].requestId,
  );
  mocks.create.mockResolvedValue(writeFailure("DUPLICATE_KEY"));
  fireEvent.click(
    screen.getByRole("button", { name: "Create and use location" }),
  );
  const existing = await screen.findByRole("button", {
    name: "Use existing location",
  });
  fireEvent.click(existing);
  expect(onPick).toHaveBeenLastCalledWith(
    expect.objectContaining({ locationId: "existing" }),
  );
});
it("does not apply a committed create after its form is unmounted", async () => {
  let finish!: (value: ReturnType<typeof writeSuccess>) => void;
  mocks.create.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick, unmount } = renderForm();
  await select("Building", "A · Building A");
  fireEvent.click(
    screen.getByRole("button", { name: "Create and use location" }),
  );
  unmount();
  await act(async () => finish(writeSuccess("named-a")));
  expect(onPick).not.toHaveBeenCalled();
});
it("keeps the draft available while offering building setup in another tab", () => {
  mocks.noBuildings = true;
  renderForm();
  expect(
    screen.getByRole("link", { name: /Set up a building/ }),
  ).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("textbox", { name: "Location code" })).toHaveValue(
    "DOCK-NEW",
  );
});

it.each([
  ["FIELD_INVALID", "code", "textbox", "Location code"],
  ["DUPLICATE_KEY", "code", "textbox", "Location code"],
  ["REFERENCE_NOT_FOUND", "buildingId", "combobox", "Building"],
  ["REFERENCE_NOT_FOUND", "floorId", "combobox", "Floor (optional)"],
])("attaches %s on %s to its field", async (code, field, role, label) => {
  mocks.create.mockResolvedValue(writeFailure(code, field));
  const { onPick } = renderForm();
  await select("Building", "A · Building A");
  fireEvent.click(
    screen.getByRole("button", { name: "Create and use location" }),
  );
  await screen.findByRole("alert");
  const control = screen.getByRole(role, { name: label });
  expect(control).toHaveAttribute("aria-invalid", "true");
  expect(control).toHaveAccessibleDescription(
    screen.getByRole("alert").textContent ?? "",
  );
  expect(onPick).not.toHaveBeenCalled();
});
