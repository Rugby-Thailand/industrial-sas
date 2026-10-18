import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";
import { JobScanScreen } from "@/features/finishedGoods/jobScan/JobScanScreen";

// FG-UX-02: photos collected in the real PhotoCapture panel are unsent work,
// but nothing registers them with the draft guard or panel ownership.
// Same harness as JobScanScreen.test.tsx, except PhotoCapture is NOT mocked.

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/features/finishedGoods/BarcodeCameraBox", () => ({
  BarcodeCameraBox: () => <div>Probe barcode scanner</div>,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.save,
  useAction: () => vi.fn(),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/hooks/useDraftKey", () => ({ useDraftKey: () => "actor-a" }));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/lib/uploadthing", () => ({
  useUploadThing: () => ({ startUpload: () => Promise.resolve(undefined) }),
}));
vi.mock("@/features/finishedGoods/jobScan/LocationPicker", () => ({
  LocationPicker: ({
    onPick,
  }: {
    onPick: (location: { text: string }) => void;
  }) => <button onClick={() => onPick({ text: "DOCK-01" })}>Pick Dock</button>,
}));

beforeEach(() => {
  window.history.replaceState(
    { appNavigationIndex: 1 },
    "",
    "/en/finished-goods/scan",
  );
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:p${++n}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function collectTwoPhotos() {
  const view = renderWithIntl(
    <DraftGuardProvider>
      <JobScanScreen />
    </DraftGuardProvider>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Pick Dock" }));
  fireEvent.click(screen.getByRole("button", { name: "Photos (AI)" }));
  const input =
    view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, {
    target: {
      files: [
        new File(["a"], "ticket-1.jpg", { type: "image/jpeg" }),
        new File(["b"], "ticket-2.jpg", { type: "image/jpeg" }),
      ],
    },
  });
  expect(
    screen.getByRole("button", { name: "Read 2 photos with AI" }),
  ).toBeEnabled();
  // No ticket exists yet: the photos are the only unsent work on the page.
  expect(screen.getByText(/No tickets yet/)).toBeVisible();
}

it("DESIRED: leaving the page with collected, unsent photos asks before discarding them", async () => {
  collectTwoPhotos();
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  // Current source: the guard only counts tickets, so this runs immediately.
  expect(leave).not.toHaveBeenCalled();
});

it("DESIRED: switching to barcode intake and back keeps the collected photos", () => {
  collectTwoPhotos();
  fireEvent.click(screen.getByRole("button", { name: "Scan barcode" }));
  expect(screen.getByText("Probe barcode scanner")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Photos (AI)" }));
  expect(
    screen.queryByRole("button", { name: "Read 2 photos with AI" }),
  ).toBeInTheDocument();
});

it("CONTROL: a typed ticket is protected by the same guard", async () => {
  renderWithIntl(
    <DraftGuardProvider>
      <JobScanScreen />
    </DraftGuardProvider>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Pick Dock" }));
  fireEvent.click(screen.getByRole("button", { name: "Type manually" }));
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(leave).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("button", { name: "Keep editing" }),
  ).toBeVisible();
});
