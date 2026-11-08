import {
  getTestMutation,
  registerTestMutation,
} from "@tests/fixtures/convex-mutation";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  status: "DRAFT",
  version: 7,
  calls: [] as { ref: unknown; args: Record<string, unknown> }[],
  bump: undefined as undefined | (() => void),
}));
vi.mock("convex/react", () => ({
  useQuery: () => ({
    ok: true,
    value: {
      found: true,
      status: state.status,
      version: state.version,
      blocked: false,
      ready: true,
      zoneCount: 3,
      positionCount: 4,
      namedRegistrationCount: 1,
      issues: [],
      complete: true,
      capacityExceeded: false,
      canArchive: true,
    },
  }),
  useMutation: getTestMutation,
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    permissionsReady: true,
    navigationPermissions: ["masterData.storageLayout.activate"],
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: "a",
  useRouter: () => ({ push: vi.fn() }),
}));
import { BuildingStatusToggle } from "./BuildingStatusToggle";
import { storageLayoutRefs } from "@/lib/convex/storageLayoutApi";

/** Re-renders like a live Convex subscription update would. */
function Live() {
  const [, setTick] = useState(0);
  useEffect(() => {
    state.bump = () => setTick((n) => n + 1);
    return () => {
      state.bump = undefined;
    };
  }, []);
  return (
    <BuildingStatusToggle
      warehouseId="warehouse"
      buildingId="building"
      code="MAIN"
      status="DRAFT"
    />
  );
}
beforeEach(() => {
  for (const ref of [
    storageLayoutRefs.activate,
    storageLayoutRefs.returnToDraft,
  ]) {
    registerTestMutation(ref, async (args: Record<string, unknown>) => {
      state.calls.push({ ref, args });
      return { ok: true, value: { written: true } };
    });
  }
  state.status = "DRAFT";
  state.version = 7;
  state.calls = [];
});

it("a confirmation reviewed as Activate never sends Return to draft after a concurrent activation", async () => {
  renderWithIntl(<Live />, { locale: "en", workspace: false });
  fireEvent.click(
    screen.getByRole("switch", { name: "Building status: MAIN" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Activate MAIN?" });
  // The manager reviews "Activate MAIN?" and aims at its confirm button.
  const confirm = within(dialog).getByRole("button", {
    name: "Activate building",
  });
  // Meanwhile another manager activates the building (version 7 -> 8).
  act(() => {
    state.status = "ACTIVE";
    state.version = 8;
    state.bump!();
  });
  // The click lands on the same button element after the live update.
  await act(async () => {
    fireEvent.click(confirm);
  });
  const reverted = state.calls.filter(
    (call) => call.ref === storageLayoutRefs.returnToDraft,
  );
  // Refuse the stale review without undoing the other manager's activation.
  expect({
    returnToDraftCalls: reverted.length,
    expectedVersions: state.calls.map((call) => call.args.expectedVersion),
  }).toEqual({ returnToDraftCalls: 0, expectedVersions: [] });
});
