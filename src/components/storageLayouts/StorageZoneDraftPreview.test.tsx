import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StorageZoneDraftPreview } from "./StorageZoneDraftPreview";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

describe("reserved draft color preview", () => {
  it("carries draft and surrounding area colors when switching views", () => {
    const { container } = render(
      <StorageZoneDraftPreview
        floorWidthMm={10000}
        floorDepthMm={10000}
        floorHeightMm={3000}
        zoneX="2"
        zoneY="2"
        zoneWidth="2"
        zoneDepth="2"
        stackHeight="3"
        zones={[]}
        variant="reserved"
        selectedColor="#123456"
        selectedLabel="Office"
        reservedBlocks={[
          {
            id: "walkway",
            label: "Walkway",
            color: "#FFFFCC",
            xMm: 0,
            yMm: 0,
            widthMm: 1000,
            depthMm: 1000,
          },
        ]}
        onPositionChange={vi.fn()}
      />,
    );
    const expectColors = () => {
      expect(
        container.querySelector('[data-area-color="#123456"] text'),
      ).toHaveTextContent("Office");
      expect(
        container.querySelector('[data-area-color="#FFFFCC"] text'),
      ).toHaveTextContent("Walkway");
      expect(container.querySelector("ul")).toHaveTextContent("Office");
      expect(container.querySelector("ul")).toHaveTextContent("Walkway");
    };
    expectColors();
    fireEvent.click(screen.getByRole("button", { name: "planView" }));
    expectColors();
  });
});
