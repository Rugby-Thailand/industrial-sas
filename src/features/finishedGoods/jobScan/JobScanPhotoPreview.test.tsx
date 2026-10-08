import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { JobScanPhotoPreview } from "./JobScanPhotoPreview";

describe("JobScanPhotoPreview", () => {
  it.each(["close button", "Escape"])(
    "opens in a modal and returns focus after %s",
    async (action) => {
      const user = userEvent.setup();
      const { container } = renderWithIntl(
        <JobScanPhotoPreview
          src="https://example.com/ticket.jpg"
          thumbnailClassName="h-20 w-14"
        />,
        { locale: "en", workspace: false },
      );
      const trigger = screen.getByRole("button", { name: "Open photo" });
      expect(container.querySelector('a[target="_blank"]')).toBeNull();
      await user.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "Open photo" });
      expect(dialog).toContainElement(
        screen.getByRole("img", { name: "Open photo" }),
      );
      expect(await axe(dialog)).toHaveNoViolations();
      if (action === "Escape") await user.keyboard("{Escape}");
      else await user.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );
});
