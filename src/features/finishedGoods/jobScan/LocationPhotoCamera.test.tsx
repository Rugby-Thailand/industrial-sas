import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("./playShutterSound", () => ({ playShutterSound: vi.fn() }));
import { playShutterSound } from "./playShutterSound";
import { createRef } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  LocationPhotoCamera,
  type LocationPhotoCameraHandle,
} from "./LocationPhotoCamera";

const stop = vi.fn();
const stream = { getTracks: () => [{ stop }] };
const getUserMedia = vi.fn();
beforeEach(() => {
  stop.mockReset();
  vi.mocked(playShutterSound).mockClear();
  getUserMedia.mockReset().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
    640,
  );
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
    480,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const onPhoto = vi.fn();
  const ref = createRef<LocationPhotoCameraHandle>();
  const view = renderWithIntl(
    <LocationPhotoCamera ref={ref} onPhoto={onPhoto} />,
    { locale: "en" },
  );
  return { onPhoto, ref, ...view };
}
it("opens immediately and delivers one still image only after capture, stopping the stream first", async () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(new Blob(["photo"], { type: "image/jpeg" })),
  );
  const { onPhoto } = setup();
  const capture = await screen.findByRole("button", {
    name: "Take location photo",
  });
  await waitFor(() => expect(capture).toBeEnabled());
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(onPhoto).not.toHaveBeenCalled();
  onPhoto.mockImplementation(() => expect(stop).toHaveBeenCalledOnce());
  fireEvent.click(capture);
  expect(drawImage).toHaveBeenCalledOnce();
  expect(playShutterSound).toHaveBeenCalledOnce();
  expect(onPhoto).toHaveBeenCalledWith(
    expect.objectContaining({ name: "location-label.jpg", type: "image/jpeg" }),
  );
});
it("stops a camera permission grant that arrives after unmount", async () => {
  let grant = () => {};
  getUserMedia.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = () => resolve(stream);
      }),
  );
  const { unmount, onPhoto } = setup();
  unmount();
  await act(async () => grant());
  expect(stop).toHaveBeenCalledOnce();
  expect(onPhoto).not.toHaveBeenCalled();
});
it("releases the stream synchronously before a native camera handoff", async () => {
  const { ref, onPhoto } = setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Take location photo" }),
    ).toBeEnabled(),
  );
  ref.current?.stop();
  expect(stop).toHaveBeenCalledOnce();
  expect(onPhoto).not.toHaveBeenCalled();
});
it("releases the stream on a failed capture and allows a fresh retry", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const { onPhoto } = setup();
  const capture = screen.getByRole("button", { name: "Take location photo" });
  await waitFor(() => expect(capture).toBeEnabled());
  fireEvent.click(capture);
  expect(stop).toHaveBeenCalledOnce();
  expect(onPhoto).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry camera" }));
  await waitFor(() => expect(capture).toBeEnabled());
  expect(getUserMedia).toHaveBeenCalledTimes(2);
});
