import { expect, it } from "vitest";
import { findFreePlacement, placementProblem } from "./zonePlacement";
import { validateStorageZone } from "../../../convex/model/storageLayout/storageZone";

// A 3 m x 3 m floor with one 1 m x 1 m column (unavailable area) in the middle.
const floor = {
  floorWidthMm: 3_000,
  floorDepthMm: 3_000,
  floorHeightMm: 4_000,
};
const column = { xMm: 1_000, yMm: 1_000, widthMm: 1_000, depthMm: 1_000 };

it("find-free-space agrees with save validation when a spot may enclose a column", () => {
  const spot = { xMm: 0, yMm: 0, widthMm: 3_000, depthMm: 3_000 };
  // The editor's own save check and the server both accept the whole floor.
  const clientProblem = placementProblem({
    draft: spot,
    heightMm: 2_000,
    ...floor,
    areas: [{ ...column, label: "Column", kind: "unavailable" }],
  });
  const server = validateStorageZone({
    ...floor,
    candidate: { ...spot, maxStackHeightMm: 2_000 },
    reserved: [column],
    zones: [],
  });
  // Keep the unavailable kind when passing editor obstacles into the search.
  const found = findFreePlacement(3_000, 3_000, 3_000, 3_000, [
    { ...column, kind: "unavailable" },
  ]);
  expect({
    clientAccepts: clientProblem === null,
    serverAccepts: server.ok,
    freePlacementFound: found !== null,
  }).toEqual({
    clientAccepts: true,
    serverAccepts: true,
    freePlacementFound: true,
  });
});

it("still rejects a contained storage spot and a partially overlapping unavailable area", () => {
  expect(
    findFreePlacement(3_000, 3_000, 3_000, 3_000, [
      { ...column, kind: "spot" },
    ]),
  ).toBeNull();
  expect(
    findFreePlacement(2_000, 2_000, 2_000, 2_000, [
      { ...column, xMm: 1_500, kind: "unavailable" },
    ]),
  ).toBeNull();
});
