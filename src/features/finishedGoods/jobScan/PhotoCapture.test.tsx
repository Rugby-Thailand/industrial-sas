import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sound = vi.hoisted(() => ({
  prime: vi.fn(),
  play: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./playShutterSound", () => ({ createShutterSound: () => sound }));
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { MAX_PHOTOS, PhotoCapture } from "./PhotoCapture";

let blobs: Array<(blob: Blob | null) => void> = [];
let urls = 0;

beforeEach(() => {
  sound.prime.mockClear();
  sound.play.mockClear();
  blobs = [];
  urls = 0;
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    },
  });
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
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => {
      blobs.push(callback);
    },
  );
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:photo-${urls++}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  renderWithIntl(<PhotoCapture onSubmit={onSubmit} onClose={onClose} />, {
    locale: "en",
  });
  const shutter = screen.getByRole("button", { name: "Take photo" });
  await waitFor(() => expect(shutter).toBeEnabled());
  return { onSubmit, onClose, shutter };
}
function gallery(count: number) {
  const files = Array.from(
    { length: count },
    (_, index) =>
      new File([`ticket-${index}`], `ticket-${index}.jpg`, {
        type: "image/jpeg",
      }),
  );
  fireEvent.change(
    screen.getByLabelText("Choose photos", { selector: "input" }),
    {
      target: { files },
    },
  );
}
function shoot(shutter: HTMLElement) {
  fireEvent.click(shutter);
  act(() => blobs.shift()!(new Blob(["jpeg"], { type: "image/jpeg" })));
}

it("collects repeated captures with one shutter click each and sends them together", async () => {
  const { onSubmit, shutter } = await setup();
  expect(
    screen.getByRole("button", { name: "Read 0 photos with AI" }),
  ).toBeDisabled();
  shoot(shutter);
  shoot(shutter);
  expect(sound.play).toHaveBeenCalledTimes(2);
  expect(screen.getByText("2 / 20 photos")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
  expect(screen.getByText("1 / 20 photos")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Read 1 photo with AI" }));
  expect(onSubmit).toHaveBeenCalledWith([
    expect.objectContaining({ type: "image/jpeg" }),
  ]);
  expect(sound.play).toHaveBeenCalledTimes(2);
});

it("never plays the shutter for gallery photos", async () => {
  await setup();
  gallery(2);
  expect(screen.getByText("2 / 20 photos")).toBeVisible();
  expect(sound.prime).not.toHaveBeenCalled();
  expect(sound.play).not.toHaveBeenCalled();
});

it("enforces the 20-photo limit for gallery selections and in-app captures", async () => {
  const { shutter } = await setup();
  gallery(MAX_PHOTOS - 1);
  fireEvent.click(shutter);
  // Gallery photos fill the last slot while the capture is still encoding.
  gallery(1);
  expect(screen.getByText("20 / 20 photos")).toBeVisible();
  act(() => blobs.shift()!(new Blob(["late"], { type: "image/jpeg" })));
  expect(sound.play).not.toHaveBeenCalled();
  expect(screen.getByText("20 / 20 photos")).toBeVisible();
  expect(shutter).toBeDisabled();
  expect(screen.getByRole("button", { name: "Choose photos" })).toBeDisabled();
  fireEvent.click(shutter);
  expect(blobs).toHaveLength(0);
  expect(sound.prime).toHaveBeenCalledOnce();
});

it("reports photos beyond the limit without dropping accepted ones", async () => {
  await setup();
  gallery(MAX_PHOTOS + 2);
  expect(screen.getByText("20 / 20 photos")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "You can add up to 20 photos.",
  );
});

it("closes from the single frame control", async () => {
  const { onClose } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Close Photo AI" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", { name: /Cancel|Stop camera/ }),
  ).not.toBeInTheDocument();
});
