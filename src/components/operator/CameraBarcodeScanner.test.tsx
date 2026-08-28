import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { CameraBarcodeScanner } from "./CameraBarcodeScanner";

const zxing = vi.hoisted(() => ({
  callback: undefined as
    | ((
        result: { getText: () => string } | undefined,
        error: Error | undefined,
        controls: { stop: () => void },
      ) => void)
    | undefined,
  decode: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints = zxing.decode;
  },
}));

const renderScanner = (onDetected = vi.fn()) => {
  renderWithIntl(
    <CameraBarcodeScanner
      triggerLabel="สแกน Area ปลายทาง"
      onDetected={onDetected}
    />,
    { locale: "th", workspace: false },
  );
  return onDetected;
};

describe("camera barcode scanner", () => {
  beforeEach(() => {
    zxing.callback = undefined;
    zxing.decode.mockReset();
    zxing.stop.mockReset();
    zxing.decode.mockImplementation(
      async (
        _constraints: MediaStreamConstraints,
        _video: HTMLVideoElement,
        callback: typeof zxing.callback,
      ) => {
        zxing.callback = callback;
        return { stop: zxing.stop };
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the rear camera and accepts a decoded destination", async () => {
    const onDetected = renderScanner();

    fireEvent.click(screen.getByRole("button", { name: "สแกน Area ปลายทาง" }));

    await waitFor(() => expect(zxing.decode).toHaveBeenCalledOnce());
    expect(zxing.decode.mock.calls[0]?.[0]).toEqual({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    expect(
      screen.getByLabelText("ภาพสดจากกล้องสำหรับสแกนปลายทาง"),
    ).toBeInTheDocument();

    act(() => {
      zxing.callback?.({ getText: () => "ISAS:LOCATION:BULK-A" }, undefined, {
        stop: zxing.stop,
      });
    });

    expect(onDetected).toHaveBeenCalledWith("ISAS:LOCATION:BULK-A");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(zxing.stop).toHaveBeenCalled();
  });

  it("keeps manual entry available when camera permission is denied", async () => {
    const denial = new Error("permission denied");
    denial.name = "NotAllowedError";
    zxing.decode.mockRejectedValueOnce(denial);
    const onDetected = renderScanner();

    fireEvent.click(screen.getByRole("button", { name: "สแกน Area ปลายทาง" }));

    expect(
      await screen.findByText("ยังไม่ได้อนุญาตให้ใช้กล้อง"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("สแกนไม่ได้? กรอกรหัสจากป้าย"), {
      target: { value: "BULK-A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ใช้รหัสนี้" }));

    expect(onDetected).toHaveBeenCalledWith("BULK-A");
  });

  it("stops the camera stream when the dialog closes", async () => {
    renderScanner();
    fireEvent.click(screen.getByRole("button", { name: "สแกน Area ปลายทาง" }));
    await waitFor(() => expect(zxing.decode).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));

    await waitFor(() => expect(zxing.stop).toHaveBeenCalled());
  });

  it("offers fallback instead of waiting forever for camera startup", async () => {
    vi.useFakeTimers();
    zxing.decode.mockReturnValueOnce(new Promise(() => undefined));
    renderScanner();

    fireEvent.click(screen.getByRole("button", { name: "สแกน Area ปลายทาง" }));
    await act(async () => undefined);
    await act(async () => vi.advanceTimersByTimeAsync(12_000));

    expect(screen.getByText("ไม่สามารถเปิดกล้องได้")).toBeInTheDocument();
    expect(screen.getByLabelText("สแกนไม่ได้? กรอกรหัสจากป้าย")).toBeEnabled();
  });
});
