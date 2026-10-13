import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  NavigationGuardProvider,
  useNavigationDraft,
} from "@/components/navigation/NavigationGuardProvider";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { trackAppHistory } from "@/lib/browser/appHistory";
import {
  WAREHOUSE_STORAGE_KEY,
  readStoredWarehouse,
  writeStoredWarehouse,
} from "@/lib/workspace/warehouseStore";
import { useWorkspace, WorkspaceProvider } from "./WorkspaceProvider";

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery_experimental: () => ({
    status: "success",
    data: {
      ok: true,
      value: {
        organization: { id: "org", name: "Company" },
        warehouses: [
          { id: "a", code: "A", name: "Warehouse A" },
          { id: "b", code: "B", name: "Warehouse B" },
          { id: "c", code: "C", name: "Warehouse C" },
        ],
        navigationPermissions: [],
        complete: true,
      },
    },
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => window.history.pushState({}, "", href),
    replace: (href: string) => window.history.replaceState({}, "", href),
    back: () => window.history.back(),
  }),
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
let release: () => void;
let finish: (() => void) | undefined;
beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, "a");
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/finished-goods?search=box#list",
  );
  release = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/th/master-data/storage-layouts/building?floor=2#map",
  );
});
afterEach(() => {
  release();
  finish = undefined;
});

function Editor({ warehouse }: { warehouse: string }) {
  const [text, setText] = useState("");
  const [receipt, setReceipt] = useState("");
  const op = useAsyncOperation({
    scope: warehouse,
    navigation: "owned",
    describeError: (code) => code,
  });
  useNavigationDraft({
    dirty: text !== "",
    pending: op.busy,
    discard: () => setText(""),
  });
  return (
    <>
      <input
        aria-label="Floor draft"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        onClick={() =>
          void op.run(
            () =>
              new Promise<void>((resolve) => {
                finish = resolve;
              }),
            () => {
              setText("");
              setReceipt(`Saved ${warehouse}`);
            },
          )
        }
      >
        Save floor
      </button>
      <output>{receipt}</output>
    </>
  );
}
function Caller() {
  const workspace = useWorkspace();
  const warehouse = workspace.selectedWarehouseId ?? "none";
  return (
    <>
      <output aria-label="Current warehouse">{warehouse}</output>
      <button onClick={() => workspace.selectWarehouse("b")}>Choose B</button>
      <button onClick={() => writeStoredWarehouse("c")}>
        Choose C outside shell
      </button>
      <Editor key={warehouse} warehouse={warehouse} />
    </>
  );
}
function renderCaller() {
  renderWithIntl(
    <WorkspaceProvider>
      <NavigationGuardProvider>
        <Caller />
      </NavigationGuardProvider>
    </WorkspaceProvider>,
    { locale: "en", workspace: false },
  );
}
async function discard() {
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
}
function external(value: string) {
  act(() => {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, value);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: WAREHOUSE_STORAGE_KEY,
        newValue: value,
        storageArea: window.localStorage,
      }),
    );
  });
}

describe("warehouse context departure ownership", () => {
  it("keeps the floor draft and persisted context until a local warehouse switch is approved", async () => {
    renderCaller();
    fireEvent.change(screen.getByRole("textbox", { name: "Floor draft" }), {
      target: { value: "retain floor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(window.localStorage.getItem(WAREHOUSE_STORAGE_KEY)).toBe("a");
    expect(screen.getByLabelText("Current warehouse")).toHaveTextContent("a");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox")).toHaveValue("retain floor");
    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    await discard();
    await waitFor(() =>
      expect(screen.getByLabelText("Current warehouse")).toHaveTextContent("b"),
    );
    expect(window.localStorage.getItem(WAREHOUSE_STORAGE_KEY)).toBe("b");
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/th/master-data/storage-layouts/building?floor=2#map");
  });
  it("guards a warehouse write outside the shell and consumes its buffer before the next Back", async () => {
    renderCaller();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "unfinished" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose C outside shell" }),
    );
    await screen.findByRole("dialog");
    await discard();
    await waitFor(() =>
      expect(screen.getByLabelText("Current warehouse")).toHaveTextContent("c"),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/th/finished-goods?search=box#list"),
    );
  });
  it("blocks context switching while the original warehouse write is pending", async () => {
    renderCaller();
    fireEvent.click(screen.getByRole("button", { name: "Save floor" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Current warehouse")).toHaveTextContent("a");
    expect(window.localStorage.getItem(WAREHOUSE_STORAGE_KEY)).toBe("a");
    await act(async () => finish?.());
    expect(screen.getByText("Saved a")).toBeVisible();
    await discard();
    await waitFor(() =>
      expect(screen.getByLabelText("Current warehouse")).toHaveTextContent("b"),
    );
    expect(screen.queryByText("Saved a")).not.toBeInTheDocument();
  });
  it("retains this tab's dirty context after another tab changes storage and adopts only the latest approved choice", async () => {
    renderCaller();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "this tab's draft" },
    });
    external("b");
    expect(screen.getByLabelText("Current warehouse")).toHaveTextContent("a");
    expect(readStoredWarehouse()).toBe("a");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox")).toHaveValue("this tab's draft");
    external("b");
    external("c");
    await discard();
    await waitFor(() =>
      expect(screen.getByLabelText("Current warehouse")).toHaveTextContent("c"),
    );
    expect(readStoredWarehouse()).toBe("c");
  });
  it("protects pending warehouse work from cross-tab replacement", async () => {
    renderCaller();
    fireEvent.click(screen.getByRole("button", { name: "Save floor" }));
    external("b");
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();
    expect(readStoredWarehouse()).toBe("a");
    await act(async () => finish?.());
    await discard();
    await waitFor(() => expect(readStoredWarehouse()).toBe("b"));
  });
});
