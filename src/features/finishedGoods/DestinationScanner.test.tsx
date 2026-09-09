import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scanner = vi.hoisted(() => ({
  decode:
    vi.fn<
      (
        device: string | undefined,
        video: HTMLVideoElement,
        callback: (
          result: { getText(): string } | undefined,
          error: Error | undefined,
          controls: { stop(): void },
        ) => void,
      ) => Promise<{ stop(): void }>
    >(),
}));

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice = scanner.decode;
  },
}));
vi.mock("./shared", () => ({ useFGText: () => ({ tr: (en: string) => en }) }));

import { DestinationScanner } from "./DestinationScanner";

beforeEach(() => {
  scanner.decode.mockReset();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

async function startCamera() {
  fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  await waitFor(() => expect(scanner.decode).toHaveBeenCalledTimes(1));
}

function emitCode(code: string, stop: () => void) {
  const call = scanner.decode.mock.calls[0];
  if (!call) throw new Error("Camera not started");
  act(() => call[2]({ getText: () => code }, undefined, { stop }));
}

describe("DestinationScanner", () => {
  it("does not open the camera on mount and labels manual verification honestly", async () => {
    const onCode = vi.fn().mockResolvedValue(undefined);
    render(<DestinationScanner onCode={onCode} expectedLocation="FG-1" />);
    expect(scanner.decode).not.toHaveBeenCalled();
    expect(screen.getByText("FG-1")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Verify entered code" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Destination code"), {
      target: { value: "  ISAS:LOCATION:1:abc  " },
    });
    fireEvent.submit(
      screen.getByLabelText("Destination code").closest("form")!,
    );
    await waitFor(() =>
      expect(onCode).toHaveBeenCalledWith("ISAS:LOCATION:1:abc", "MANUAL"),
    );
    expect(
      screen.getByText(/recorded as manual code verification/),
    ).toBeVisible();
    expect(scanner.decode).not.toHaveBeenCalled();
  });

  it("opens only on request, stops after a decode, and ignores repeated frames", async () => {
    const stop = vi.fn();
    scanner.decode.mockResolvedValue({ stop });
    const onCode = vi.fn().mockResolvedValue(undefined);
    render(<DestinationScanner onCode={onCode} expectedLocation="FG-1" />);
    await startCamera();
    emitCode("ISAS:LOCATION:1:abc", stop);
    emitCode("ISAS:LOCATION:1:abc", stop);
    await waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
    expect(onCode).toHaveBeenCalledWith("ISAS:LOCATION:1:abc", "SCAN");
    expect(stop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start camera" })).toBeVisible();
    expect(screen.queryByText("Destination verified")).not.toBeInTheDocument();
  });

  it("stops the scanner and media tracks when unmounted", async () => {
    const stop = vi.fn();
    const trackStop = vi.fn();
    scanner.decode.mockImplementation(async (_device, video) => {
      Object.defineProperty(video, "srcObject", {
        configurable: true,
        writable: true,
        value: { getTracks: () => [{ stop: trackStop }] },
      });
      return { stop };
    });
    const { unmount } = render(
      <DestinationScanner onCode={vi.fn()} expectedLocation="FG-1" />,
    );
    await startCamera();
    unmount();
    expect(stop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });

  it("stops a late camera startup after the dialog has unmounted", async () => {
    const stop = vi.fn();
    const trackStop = vi.fn();
    let finish: ((value: { stop(): void }) => void) | undefined;
    scanner.decode.mockImplementation(
      (_device, video) =>
        new Promise((resolve) => {
          finish = (value) => {
            Object.defineProperty(video, "srcObject", {
              configurable: true,
              writable: true,
              value: { getTracks: () => [{ stop: trackStop }] },
            });
            resolve(value);
          };
        }),
    );
    const { unmount } = render(
      <DestinationScanner onCode={vi.fn()} expectedLocation="FG-1" />,
    );
    await startCamera();
    unmount();
    await act(async () => {
      finish?.({ stop });
    });
    expect(stop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });

  it("keeps manual entry and retry available when camera permission fails", async () => {
    scanner.decode.mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    render(<DestinationScanner onCode={vi.fn()} expectedLocation="FG-1" />);
    await startCamera();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Camera unavailable",
    );
    expect(screen.getByLabelText("Destination code")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled();
  });

  it("handles browsers without a camera API", async () => {
    vi.stubGlobal("navigator", {});
    render(<DestinationScanner onCode={vi.fn()} expectedLocation="FG-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Camera unavailable",
    );
    expect(scanner.decode).not.toHaveBeenCalled();
  });

  it("ignores ordinary no-code frames but reports unexpected reader errors", async () => {
    const stop = vi.fn();
    scanner.decode.mockResolvedValue({ stop });
    render(<DestinationScanner onCode={vi.fn()} expectedLocation="FG-1" />);
    await startCamera();
    const call = scanner.decode.mock.calls[0];
    if (!call) throw new Error("Camera not started");
    act(() =>
      call[2](
        undefined,
        Object.assign(new Error(), { name: "NotFoundException" }),
        { stop },
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() => call[2](undefined, new Error("Video read failed"), { stop }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not read the code",
    );
    expect(stop).toHaveBeenCalled();
  });

  it("retains entered code after failed verification and allows retry", async () => {
    const onCode = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network failure"))
      .mockResolvedValue(undefined);
    render(<DestinationScanner onCode={onCode} expectedLocation="FG-1" />);
    fireEvent.change(screen.getByLabelText("Destination code"), {
      target: { value: "wrong-code" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify entered code" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be verified",
    );
    expect(screen.getByLabelText("Destination code")).toHaveValue("wrong-code");
    fireEvent.click(
      screen.getByRole("button", { name: "Verify entered code" }),
    );
    await waitFor(() => expect(onCode).toHaveBeenCalledTimes(2));
  });

  it("stops active camera on verified state and does not offer storage confirmation", async () => {
    const stop = vi.fn();
    const onCode = vi.fn();
    scanner.decode.mockResolvedValue({ stop });
    const view = render(
      <DestinationScanner onCode={onCode} expectedLocation="FG-1" />,
    );
    await startCamera();
    view.rerender(
      <DestinationScanner onCode={onCode} expectedLocation="FG-1" verified />,
    );
    expect(stop).toHaveBeenCalled();
    expect(screen.getByText("Destination verified")).toBeVisible();
    expect(screen.getByLabelText("Destination code")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Confirm stored" }),
    ).not.toBeInTheDocument();
  });
  it("waits for a cancelled startup to finish before allowing another camera", async () => {
    const stop = vi.fn();
    let finish: ((value: { stop(): void }) => void) | undefined;
    scanner.decode.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<DestinationScanner onCode={vi.fn()} expectedLocation="FG-1" />);
    await startCamera();
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(screen.getByRole("button", { name: "Start camera" })).toBeDisabled();
    expect(screen.getByLabelText("Destination code")).toBeEnabled();
    await act(async () => {
      finish?.({ stop });
    });
    expect(stop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled();
  });

  it("handles a decode arriving before camera startup resolves", async () => {
    const stop = vi.fn();
    scanner.decode.mockImplementation(async (_device, _video, callback) => {
      callback({ getText: () => "early-qr" }, undefined, { stop });
      return { stop };
    });
    const onCode = vi.fn().mockResolvedValue(undefined);
    render(<DestinationScanner onCode={onCode} expectedLocation="FG-1" />);
    await startCamera();
    await waitFor(() =>
      expect(onCode).toHaveBeenCalledWith("early-qr", "SCAN"),
    );
    expect(stop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled();
  });
  it("lets the parent display a precise verification refusal without a second generic error", async () => {
    const onCode = vi.fn().mockRejectedValue(new Error("DESTINATION_MISMATCH"));
    render(
      <DestinationScanner
        onCode={onCode}
        expectedLocation="FG-1"
        showVerificationErrors={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Destination code"), {
      target: { value: "wrong" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify entered code" }),
    );
    await waitFor(() => expect(onCode).toHaveBeenCalledWith("wrong", "MANUAL"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Verify entered code" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Destination code")).toHaveValue("wrong");
  });
});
