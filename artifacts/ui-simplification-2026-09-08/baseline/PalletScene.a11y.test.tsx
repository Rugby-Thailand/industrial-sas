import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { expect, it } from "vitest";

import { PalletScene } from "./PalletScene";

it("exposes the Thai pallet controls and placement instructions accessibly", async () => {
  const { container } = render(
    <PalletScene
      dimensions={{ widthMm: 1_200, depthMm: 1_000, heightMm: 1_400 }}
      area={{ widthMm: 3_000, depthMm: 3_000, heightMm: 3_000 }}
      placement={{ xMm: 0, yMm: 0, rotation: 0 }}
      onPlacementChange={() => undefined}
      editable
      locale="th"
      label="FG-1"
    />,
  );
  expect(await axe(container)).toHaveNoViolations();
});

it.each(["RESERVED", "STORED"] as const)(
  "keeps %s destination status accessible",
  async (status) => {
    const { container } = render(
      <PalletScene
        dimensions={{ widthMm: 1000, depthMm: 1200, heightMm: 1400 }}
        area={{ widthMm: 2000, depthMm: 2000, heightMm: 3000 }}
        locale="en"
        status={status}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  },
);
