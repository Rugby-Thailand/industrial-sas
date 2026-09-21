import type { ReactElement } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IScannerControls } from "@zxing/browser";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
function renderIntl(ui: ReactElement) {
  return renderWithIntl(ui, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
}
const mocks = vi.hoisted(() => ({
  decode:
    vi.fn<
      (
        stream: MediaStream,
        video: HTMLVideoElement,
        callback: (
          result: { getText(): string } | undefined,
          error: Error | undefined,
          controls: IScannerControls,
        ) => void,
      ) => Promise<IScannerControls>
    >(),
  getUserMedia: vi.fn(),
}));
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromStream = mocks.decode;
  },
}));
import { PackageScanCamera } from "./PackageScanCamera";

const stop = vi.fn();
const trackStop = vi.fn();
const stream = {
  getTracks: () => [{ stop: trackStop }],
  getVideoTracks: () => [{ getCapabilities: () => ({}) }],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserMedia.mockResolvedValue(stream);
  mocks.decode.mockResolvedValue({ stop });
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: mocks.getUserMedia },
  });
});
afterEach(() => vi.unstubAllGlobals());
function emit(code: string, index = 0) {
  act(() =>
    mocks.decode.mock.calls[index]![2]({ getText: () => code }, undefined, {
      stop,
    }),
  );
}
async function started(count = 1) {
  await waitFor(() => expect(mocks.decode).toHaveBeenCalledTimes(count));
}
const base = {
  mode: "PACKAGES" as const,
  active: true,
  count: 0,
  onBack: vi.fn(),
};

describe("PackageScanCamera", () => {
  it("continuously delivers distinct barcode/QR text with per-code cooldown and fresh handlers", async () => {
    const onCode = vi.fn();
    const view = renderIntl(<PackageScanCamera {...base} onCode={onCode} />);
    await started();
    emit("barcode-A");
    emit("barcode-A");
    emit("ISAS:PALLET:1:B");
    expect(onCode.mock.calls).toEqual([["barcode-A"], ["ISAS:PALLET:1:B"]]);
    expect(stop).not.toHaveBeenCalled();
    const next = vi.fn();
    view.rerender(<PackageScanCamera {...base} count={2} onCode={next} />);
    emit("C");
    expect(next).toHaveBeenCalledWith("C");
    expect(mocks.decode).toHaveBeenCalledTimes(1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1100);
    emit("barcode-A");
    expect(next).toHaveBeenCalledWith("barcode-A");
    clock.mockRestore();
    expect(mocks.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
  });

  it("ignores old mode callbacks and cleans streams on pause/unmount", async () => {
    const onCode = vi.fn();
    const view = renderIntl(<PackageScanCamera {...base} onCode={onCode} />);
    await started();
    view.rerender(
      <PackageScanCamera {...base} mode="LOCATION" onCode={onCode} />,
    );
    emit("old-package");
    await started(2);
    emit("location", 1);
    expect(onCode.mock.calls).toEqual([["location"]]);
    view.rerender(
      <PackageScanCamera
        {...base}
        mode="LOCATION"
        active={false}
        onCode={onCode}
      />,
    );
    emit("late-location", 1);
    expect(onCode).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(trackStop).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("stops media acquired after unmount without starting a decoder", async () => {
    let finish!: (value: typeof stream) => void;
    mocks.getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = renderIntl(<PackageScanCamera {...base} onCode={vi.fn()} />);
    await waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalled());
    view.unmount();
    await act(async () => finish(stream));
    expect(trackStop).toHaveBeenCalled();
    expect(mocks.decode).not.toHaveBeenCalled();
  });

  it("cleans late decoder startup and serializes the next mode startup", async () => {
    let finish!: (value: IScannerControls) => void;
    mocks.decode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = renderIntl(<PackageScanCamera {...base} onCode={vi.fn()} />);
    await started();
    view.rerender(
      <PackageScanCamera {...base} mode="LOCATION" onCode={vi.fn()} />,
    );
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => finish({ stop }));
    await started(2);
    expect(stop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });

  it("offers permission-specific recovery and retries", async () => {
    mocks.getUserMedia.mockRejectedValueOnce(
      new DOMException("Denied", "NotAllowedError"),
    );
    renderIntl(<PackageScanCamera {...base} onCode={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Camera permission denied",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry camera" }));
    await started();
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("ignores normal decode misses and stops on fatal decoder errors", async () => {
    renderIntl(<PackageScanCamera {...base} onCode={vi.fn()} />);
    await started();
    act(() =>
      mocks.decode.mock.calls[0]![2](
        undefined,
        Object.assign(new Error(), { name: "NotFoundException" }),
        { stop },
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() =>
      mocks.decode.mock.calls[0]![2](undefined, new Error("Fatal"), { stop }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("could not read");
    expect(stop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });
  it("reports missing camera APIs and keeps retry available", async () => {
    vi.stubGlobal("navigator", {});
    renderIntl(<PackageScanCamera {...base} onCode={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Camera unavailable",
    );
    expect(screen.getByRole("button", { name: "Retry camera" })).toBeEnabled();
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Flashlight" }),
    ).not.toBeInTheDocument();
  });

  it("offers flashlight only with actual track capability and handles toggle failure", async () => {
    const switchTorch = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Unavailable"));
    mocks.getUserMedia.mockResolvedValue({
      ...stream,
      getVideoTracks: () => [{ getCapabilities: () => ({ torch: true }) }],
    });
    mocks.decode.mockResolvedValue({ stop, switchTorch });
    renderIntl(<PackageScanCamera {...base} onCode={vi.fn()} />);
    const torch = await screen.findByRole("button", { name: "Flashlight" });
    fireEvent.click(torch);
    await waitFor(() => expect(torch).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(torch);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Flashlight unavailable",
    );
    expect(stop).not.toHaveBeenCalled();
  });
  it("releases camera tracks even when ZXing torch shutdown rejects", async () => {
    const torchStop = vi
      .fn()
      .mockRejectedValue(new Error("Track already ended"));
    mocks.decode.mockResolvedValue({ stop: torchStop });
    const view = renderIntl(<PackageScanCamera {...base} onCode={vi.fn()} />);
    await started();
    await act(async () => view.unmount());
    expect(torchStop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });
});

it.each([
  ["success", "Package added", "border-success"],
  ["duplicate", "Package already scanned", "border-warning"],
  ["error", "Package unavailable", "border-danger"],
] as const)(
  "shows %s feedback with the code in one nonblocking live region",
  async (kind, message, color) => {
    const onBack = vi.fn();
    const onCode = vi.fn();
    const view = renderIntl(
      <PackageScanCamera {...base} onBack={onBack} onCode={onCode} />,
    );
    await started();
    view.rerender(
      <PackageScanCamera
        {...base}
        onBack={onBack}
        onCode={onCode}
        feedback={{ kind, message, code: "P-000123" }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(message);
    expect(status).toHaveTextContent("P-000123");
    expect(status.firstElementChild).toHaveClass(color, "pointer-events-none");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    emit("NEXT-CODE");
    expect(onCode).toHaveBeenCalledWith("NEXT-CODE");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(mocks.decode).toHaveBeenCalledTimes(1);
  },
);
