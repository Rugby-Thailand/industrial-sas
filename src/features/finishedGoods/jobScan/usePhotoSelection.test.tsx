import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAX_PHOTOS, usePhotoSelection } from "./usePhotoSelection";

const photo = (name: string) =>
  new File(["jpeg"], name, { type: "image/jpeg", lastModified: 1 });

beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation((file) =>
    file instanceof File ? `blob:${file.name}` : "blob:photo",
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("applies the photo limit synchronously across additions in one render", () => {
  const { result } = renderHook(usePhotoSelection);
  act(() => {
    result.current.add(
      Array.from({ length: MAX_PHOTOS - 1 }, (_, i) => photo(`${i}.jpg`)),
    );
    result.current.add([photo("last.jpg"), photo("overflow.jpg")]);
    expect(result.current.canCapture()).toBe(false);
  });
  expect(result.current.photos).toHaveLength(MAX_PHOTOS);
  expect(result.current.problem).toBe("photoLimit");
  expect(URL.createObjectURL).toHaveBeenCalledTimes(MAX_PHOTOS);
});

it("keeps separate camera shots with identical metadata and skips gallery duplicates", () => {
  const { result } = renderHook(usePhotoSelection);
  const first = photo("same.jpg");
  const second = photo("same.jpg");
  act(() => {
    result.current.add([first, second]);
    result.current.add([first, second], "camera");
  });
  expect(result.current.getFiles()).toEqual([first, first, second]);
});

it("accepts the original-photo size boundary and rejects oversized images", () => {
  const { result } = renderHook(usePhotoSelection);
  const boundary = new File(
    [new ArrayBuffer(25 * 1024 * 1024)],
    "boundary.jpg",
    { type: "image/jpeg" },
  );
  const tooLarge = new File([boundary, "x"], "large.jpg", {
    type: "image/jpeg",
  });
  act(() => result.current.add([boundary, tooLarge]));
  expect(result.current.getFiles()).toEqual([boundary]);
  expect(result.current.problem).toBe("imageSize");
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
});

it("ignores stale acquisition callbacks after unmount without creating previews", () => {
  const { result, unmount } = renderHook(usePhotoSelection);
  act(() => result.current.add([photo("collected.jpg")]));
  const { add, clear, canCapture } = result.current;
  unmount();
  act(() => {
    add([photo("late.jpg")], "camera");
    clear();
  });
  expect(canCapture()).toBe(false);
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
    "blob:collected.jpg",
  );
});
