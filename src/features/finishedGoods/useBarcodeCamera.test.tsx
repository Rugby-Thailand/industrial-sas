import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBarcodeCamera } from "./useBarcodeCamera";

type Controls = { stop(): void; switchTorch?: (on: boolean) => Promise<void> };
type DecodeCallback = (
  result: { getText(): string } | undefined,
  error: Error | undefined,
  controls: Controls,
) => void;
const mocks = vi.hoisted(() => ({
  decode:
    vi.fn<
      (
        stream: MediaStream,
        video: HTMLVideoElement,
        callback: DecodeCallback,
      ) => Promise<Controls>
    >(),
  media: vi.fn(),
  stop: vi.fn(),
  trackStop: vi.fn(),
}));
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromStream = mocks.decode;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  const track = { stop: mocks.trackStop, getCapabilities: () => ({}) };
  mocks.media.mockReset().mockResolvedValue({
    getTracks: () => [track],
    getVideoTracks: () => [track],
  });
  mocks.decode.mockReset().mockResolvedValue({ stop: mocks.stop });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: mocks.media } });
});
afterEach(() => vi.unstubAllGlobals());
function Camera({
  active = true,
  mode = "PACKAGES",
  onCode = () => {},
}: {
  active?: boolean;
  mode?: "PACKAGES" | "LOCATION";
  onCode?: (code: string) => void;
}) {
  const { videoRef, state, error, stop } = useBarcodeCamera({
    active,
    mode,
    onCode,
  });
  return (
    <>
      <video ref={videoRef} />
      <p>
        {state}:{error}
      </p>
      <button onClick={stop}>Stop now</button>
    </>
  );
}
async function ready() {
  await waitFor(() => expect(screen.getByText("ACTIVE:")).toBeInTheDocument());
}
function emit(code: string, index = 0) {
  const callback = mocks.decode.mock.calls[index]![2];
  callback({ getText: () => code }, undefined, { stop: mocks.stop });
}
it("reads distinct codes continuously with one acquisition, preserves leading zeroes and suppresses repeats", async () => {
  const onCode = vi.fn();
  render(<Camera onCode={onCode} />);
  await ready();
  act(() => {
    emit(" 0000123 ");
    emit("0000123");
    emit("PRODUCT-B");
  });
  expect(onCode.mock.calls).toEqual([["0000123"], ["PRODUCT-B"]]);
  expect(mocks.media).toHaveBeenCalledTimes(1);
  expect(mocks.stop).not.toHaveBeenCalled();
});
it("delivers to the latest callback without reopening the camera", async () => {
  const old = vi.fn(),
    latest = vi.fn();
  const view = render(<Camera onCode={old} />);
  await ready();
  view.rerender(<Camera onCode={latest} />);
  act(() => emit("PRODUCT-A"));
  expect(old).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith("PRODUCT-A");
  expect(mocks.media).toHaveBeenCalledTimes(1);
});
it("releases tracks and ignores old decoder callbacks after mode changes", async () => {
  const onCode = vi.fn();
  const view = render(<Camera onCode={onCode} />);
  await ready();
  view.rerender(<Camera mode="LOCATION" onCode={onCode} />);
  await waitFor(() => expect(mocks.decode).toHaveBeenCalledTimes(2));
  act(() => {
    emit("OLD", 0);
    emit("ZONE-A", 1);
  });
  expect(onCode.mock.calls).toEqual([["ZONE-A"]]);
  expect(mocks.trackStop).toHaveBeenCalled();
});
it("releases a media stream granted after unmount", async () => {
  let finish!: (stream: unknown) => void;
  mocks.media.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onCode = vi.fn(),
    view = render(<Camera onCode={onCode} />);
  await waitFor(() => expect(mocks.media).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () =>
    finish({
      getTracks: () => [{ stop: mocks.trackStop }],
      getVideoTracks: () => [],
    }),
  );
  expect(mocks.trackStop).toHaveBeenCalledTimes(1);
  expect(mocks.decode).not.toHaveBeenCalled();
  expect(onCode).not.toHaveBeenCalled();
});
it("contains a rejected decoder shutdown while always stopping the physical tracks", async () => {
  mocks.decode.mockResolvedValue({
    stop: () => Promise.reject(new Error("Torch ended")),
  });
  const view = render(<Camera />);
  await ready();
  view.unmount();
  await act(async () => {});
  expect(mocks.trackStop).toHaveBeenCalled();
});
it("reports denied permission without decoding or leaking a stream", async () => {
  mocks.media.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  render(<Camera />);
  expect(await screen.findByText("ERROR:PERMISSION")).toBeInTheDocument();
  expect(mocks.decode).not.toHaveBeenCalled();
});
it("reports unexpected decoder errors and closes the stream", async () => {
  render(<Camera />);
  await ready();
  act(() =>
    mocks.decode.mock.calls[0]![2](undefined, new Error("Read failed"), {
      stop: mocks.stop,
    }),
  );
  expect(screen.getByText("ERROR:DECODER")).toBeInTheDocument();
  expect(mocks.trackStop).toHaveBeenCalled();
});
