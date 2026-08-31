import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useLinkStatusMock } = vi.hoisted(() => ({
  useLinkStatusMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  useLinkStatus: useLinkStatusMock,
}));

import { NavigationPendingIndicator } from "./NavigationPendingIndicator";

describe("NavigationPendingIndicator", () => {
  beforeEach(() => {
    useLinkStatusMock.mockReturnValue({ pending: false });
  });

  it("reserves a hidden indicator when navigation is idle", () => {
    const { container } = render(<NavigationPendingIndicator />);

    expect(container.firstChild).toHaveAttribute("data-pending", "false");
  });

  it("exposes the pending state for the enclosing link", () => {
    useLinkStatusMock.mockReturnValue({ pending: true });

    const { container } = render(<NavigationPendingIndicator />);

    expect(container.firstChild).toHaveAttribute("data-pending", "true");
  });
});
