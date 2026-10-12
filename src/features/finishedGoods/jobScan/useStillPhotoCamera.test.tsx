import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import type * as ShutterModule from "./playShutterSound";

const sound = vi.hoisted(() => ({
  prime: vi.fn(),
  play: vi.fn(),
  dispose: vi.fn(),
  real: false,
}));
vi.mock("./playShutterSound", async (original) => {
  const actual = await original<typeof ShutterModule>();
  return {
    createShutterSound: () =>
      sound.real
        ? actual.createShutterSound()
        : { prime: sound.prime, play: sound.play, dispose: sound.dispose },
  };
});
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  StillPhotoCamera,
  type StillPhotoCameraHandle,
} from "./StillPhotoCamera";

const trackStop = vi.fn();
const getUserMedia = vi.fn();
let blobs: Array<(blob: Blob | null) => void> = [];

beforeEach(() => {
  sound.real = false;
  sound.prime.mockClear();
  sound.play.mockClear();
  sound.dispose.mockClear();
  trackStop.mockReset();
  blobs = [];
  getUserMedia
    .mockReset()
    .mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
    640,
  );
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
    480,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  // Encoding is asynchronous in browsers; each test settles it explicitly.
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => {
      blobs.push(callback);
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const photo = () => new Blob(["jpeg"], { type: "image/jpeg" });

async function setup(
  props: Partial<Parameters<typeof StillPhotoCamera>[0]> = {},
) {
  const onPhoto = vi.fn();
  const ref = createRef<StillPhotoCameraHandle>();
  const view = renderWithIntl(
    <StillPhotoCamera
      ref={ref}
      onPhoto={onPhoto}
      captureLabel="Take photo"
      fileName={() => "ticket.jpg"}
      {...props}
    />,
    { locale: "en", preserveProviders: true },
  );
  const shutter = screen.getByRole("button", { name: "Take photo" });
  await waitFor(() => expect(shutter).toBeEnabled());
  return { ...view, onPhoto, ref, shutter };
}

it("plays one shutter click for every delivered photo, including repeated captures", async () => {
  const { onPhoto, shutter } = await setup();
  for (let shot = 1; shot <= 3; shot++) {
    fireEvent.click(shutter);
    expect(sound.prime).toHaveBeenCalledTimes(shot);
    // The click plays only once the encoded photo is valid.
    expect(sound.play).toHaveBeenCalledTimes(shot - 1);
    act(() => blobs.shift()!(photo()));
    expect(sound.play).toHaveBeenCalledTimes(shot);
    expect(onPhoto).toHaveBeenCalledTimes(shot);
  }
  expect(onPhoto).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "ticket.jpg", type: "image/jpeg" }),
  );
  expect(trackStop).not.toHaveBeenCalled();
});

it("ignores rapid presses while one photo is still encoding", async () => {
  const { onPhoto, shutter } = await setup();
  fireEvent.click(shutter);
  fireEvent.click(shutter);
  fireEvent.click(shutter);
  expect(blobs).toHaveLength(1);
  act(() => blobs.shift()!(photo()));
  expect(sound.play).toHaveBeenCalledOnce();
  expect(onPhoto).toHaveBeenCalledOnce();
  fireEvent.click(shutter);
  expect(blobs).toHaveLength(1);
});

it("stays silent and reports a failed encode without delivering a photo", async () => {
  const { onPhoto, shutter } = await setup();
  fireEvent.click(shutter);
  act(() => blobs.shift()!(null));
  expect(sound.play).not.toHaveBeenCalled();
  expect(onPhoto).not.toHaveBeenCalled();
  expect(trackStop).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert")).toHaveTextContent("Camera access");
  expect(screen.getByRole("button", { name: "Retry camera" })).toBeVisible();
});

it.each(["close", "unmount"])(
  "drops a capture that finishes after %s",
  async (change) => {
    const { onPhoto, shutter, ref, unmount } = await setup();
    fireEvent.click(shutter);
    if (change === "close") ref.current!.stop();
    else unmount();
    act(() => blobs.shift()!(photo()));
    expect(sound.play).not.toHaveBeenCalled();
    expect(onPhoto).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalledOnce();
    if (change === "unmount") expect(sound.dispose).toHaveBeenCalledOnce();
  },
);

it("drops a capture after a source switch replaces the session", async () => {
  const { onPhoto, shutter, rerender } = await setup();
  fireEvent.click(shutter);
  const late = blobs.shift()!;
  // A different source owns the area now; the old session is unmounted.
  rerender(<p>Gallery photo selected</p>);
  act(() => late(photo()));
  expect(sound.play).not.toHaveBeenCalled();
  expect(onPhoto).not.toHaveBeenCalled();
});

it("does nothing for disabled or over-limit presses and drops a photo that lands after the limit fills", async () => {
  let allowed = true;
  const { onPhoto, shutter, rerender } = await setup({
    canCapture: () => allowed,
  });
  fireEvent.click(shutter);
  allowed = false;
  act(() => blobs.shift()!(photo()));
  expect(sound.play).not.toHaveBeenCalled();
  expect(onPhoto).not.toHaveBeenCalled();
  fireEvent.click(shutter);
  expect(sound.prime).toHaveBeenCalledOnce();
  expect(blobs).toHaveLength(0);
  rerender(
    <StillPhotoCamera
      onPhoto={onPhoto}
      captureLabel="Take photo"
      fileName={() => "ticket.jpg"}
      captureDisabled
    />,
  );
  expect(screen.getByRole("button", { name: "Take photo" })).toBeDisabled();
});

it.each(["blocked", "rejected"])(
  "still delivers the photo when audio is %s",
  async (kind) => {
    sound.real = true;
    vi.stubGlobal(
      "AudioContext",
      kind === "blocked"
        ? class {
            constructor() {
              throw new DOMException("Blocked", "NotAllowedError");
            }
          }
        : class {
            state = "suspended";
            currentTime = 0;
            sampleRate = 44_100;
            resume = () =>
              Promise.reject(new DOMException("No", "NotAllowedError"));
            close = () => Promise.resolve();
            createBuffer() {
              throw new Error("No audio");
            }
          },
    );
    const { onPhoto, shutter } = await setup();
    fireEvent.click(shutter);
    await act(async () => blobs.shift()!(photo()));
    expect(onPhoto).toHaveBeenCalledOnce();
  },
);
