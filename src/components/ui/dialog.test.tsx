import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog";

it("returns keyboard focus to the opener for a programmatic dialog", async () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Review</button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Review destination</DialogTitle>
            <DialogDescription>Check before reserving.</DialogDescription>
            <button onClick={() => setOpen(false)}>Back to edit</button>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  const user = userEvent.setup();
  render(<Example />);
  const opener = screen.getByRole("button", { name: "Review" });
  await user.click(opener);
  expect(screen.getByRole("dialog")).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(opener).toHaveFocus());
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("button", { name: "Back to edit" }));
  await waitFor(() => expect(opener).toHaveFocus());
});
