import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StorageZoneDraftPreview } from "./StorageZoneDraftPreview";
import { measuredMillimetres } from "@/features/storageLayouts/measure";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

// The zone dialog saves only when measuredMillimetres accepts every field;
// the preview next to it announces "fits" from its own, looser parser.
describe.each(["", "2.0005", "2e0"])(
  "draft preview agrees with save validation for X=%j",
  (zoneX) => {
    it("preview must not say the zone fits when save validation rejects X", () => {
      render(
        <StorageZoneDraftPreview
          floorWidthMm={10000}
          floorDepthMm={10000}
          floorHeightMm={3000}
          zoneX={zoneX}
          zoneY="2"
          zoneWidth="2"
          zoneDepth="2"
          stackHeight="2"
          zones={[]}
          onPositionChange={vi.fn()}
        />,
      );
      const saveAccepts = measuredMillimetres(zoneX) !== null;
      expect(saveAccepts).toBe(false);
      const previewSaysFits =
        screen.queryByText("zoneFitsFloor") !== null ? 1 : 0;
      expect(previewSaysFits).toBe(0);
    });
  },
);
