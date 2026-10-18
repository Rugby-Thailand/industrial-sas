import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  warehouse: "warehouse-a",
  create: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => state.create,
  useQuery: () => undefined,
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children(state.warehouse),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ replace: state.replace, push: vi.fn(), back: vi.fn() }),
}));

import { NewStorageBuildingForm } from "@/features/storageLayouts/StorageLayoutScreens";

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

it("a late building-create completion must not navigate the replacement warehouse", async () => {
  state.warehouse = "warehouse-a";
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/master-data/storage-layouts/new",
  );
  let finish: ((value: unknown) => void) | undefined;
  state.create.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = renderWithIntl(<NewStorageBuildingForm />, {
    locale: "en",
    preserveProviders: true,
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Building code" }), {
    target: { value: "BUILDING-IN-A" },
  });
  fireEvent.submit(
    screen.getByRole("textbox", { name: "Building code" }).closest("form")!,
  );
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
  expect(state.create.mock.calls[0]![0].warehouseId).toBe("warehouse-a");
  // An external workspace update rerenders QueryGate; the form has no warehouse key.
  state.warehouse = "warehouse-b";
  view.rerender(<NewStorageBuildingForm />);
  await act(async () => {
    finish?.({
      ok: true,
      value: { written: true, documentId: "building-in-a" },
    });
    await Promise.resolve();
  });
  console.info("LATE_COMPLETION_EVIDENCE", {
    currentWarehouse: state.warehouse,
    replacements: state.replace.mock.calls,
  });
  expect(state.replace).not.toHaveBeenCalled();
});
