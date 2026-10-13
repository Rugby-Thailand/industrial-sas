import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState, type ComponentProps } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { PageHeader } from "./PageHeader";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

const router = vi.hoisted(() => ({
  back: () => window.history.back(),
  replace: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => router,
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
let stop: () => void;
beforeEach(() => {
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/profile");
  stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/scan?other=keep#question",
  );
});
afterEach(() => stop());
it("browser Back dismisses PageHeader help before leaving the current page", async () => {
  renderWithIntl(
    <PageHeader title="Job tickets" helpText="Where is the stock?" />,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "About this page" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe("/en/finished-goods/scan?other=keep#question");
});
it("browser Back dismisses the controlled Sheet before leaving its caller", async () => {
  function Caller() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Details</button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent>
            <SheetTitle>Location details</SheetTitle>
          </SheetContent>
        </Sheet>
      </>
    );
  }
  renderWithIntl(<Caller />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(window.location.pathname).toBe("/en/finished-goods/scan");
});
