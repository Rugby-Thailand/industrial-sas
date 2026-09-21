import { beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((href: string): never => {
    throw new Error(`redirect:${href}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("not-found");
  }),
}));
vi.mock("next/navigation", () => navigation);

import StorageFloorPage from "./page";

beforeEach(() => vi.clearAllMocks());

it.each(["en", "th"])(
  "redirects a legacy %s floor URL to the editable building workspace",
  async (locale) => {
    await expect(
      StorageFloorPage({
        params: Promise.resolve({
          locale,
          buildingId: "building-a",
          floorNumber: "4",
        }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(
      `redirect:/${locale}/master-data/storage-layouts/building-a?floor=4&editing=1`,
    );
    expect(navigation.notFound).not.toHaveBeenCalled();
  },
);

it("preserves the selected zone without allowing it to change other query parameters", async () => {
  await expect(
    StorageFloorPage({
      params: Promise.resolve({
        locale: "th",
        buildingId: "building-a",
        floorNumber: "02",
      }),
      searchParams: Promise.resolve({ editZone: "zone a&floor=9" }),
    }),
  ).rejects.toThrow(
    "redirect:/th/master-data/storage-layouts/building-a?floor=2&editing=1&editZone=zone+a%26floor%3D9",
  );
});

it.each(["0", "-1", "1.5", "NaN", "Infinity", "1e2", "9007199254740992"])(
  "rejects invalid floor number %s",
  async (floorNumber) => {
    await expect(
      StorageFloorPage({
        params: Promise.resolve({
          locale: "en",
          buildingId: "building-a",
          floorNumber,
        }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("not-found");
    expect(navigation.redirect).not.toHaveBeenCalled();
  },
);

it("rejects an unsupported locale", async () => {
  await expect(
    StorageFloorPage({
      params: Promise.resolve({
        locale: "other",
        buildingId: "building-a",
        floorNumber: "1",
      }),
      searchParams: Promise.resolve({}),
    }),
  ).rejects.toThrow("not-found");
});
