import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useState, type ComponentProps } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

const router = vi.hoisted(() => ({
  back: () => window.history.back(),
  replace: (url: string) => window.history.replaceState({}, "", url),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => router,
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
let stop: () => void;
beforeEach(() => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/hr/profile?origin=yes#origin",
  );
  stop = trackAppHistory();
  window.history.pushState(
    {},
    "",
    "/en/master-data/storage-layouts/building-a?floor=2&kept=yes#map",
  );
});
afterEach(() => stop());

let toggle: {
  first: (open: boolean) => void;
  second: (open: boolean) => void;
  pending: (value: boolean) => void;
};
function Form({
  name,
  initial = "",
  busy = false,
  saveable = false,
}: {
  name: string;
  initial?: string;
  busy?: boolean;
  saveable?: boolean;
}) {
  const [text, setText] = useState(initial);
  useNavigationDraft({
    dirty: text !== "",
    pending: busy,
    discard: () => setText(""),
    ...(saveable
      ? {
          save: async () => {
            setText("");
            return true;
          },
        }
      : {}),
  });
  return (
    <label>
      {name}
      <input value={text} onChange={(event) => setText(event.target.value)} />
    </label>
  );
}
function AlwaysMounted({
  secondSheet = false,
  firstDraft = "",
  secondDraft = "",
  pendingFirst = false,
  firstSaveable = false,
}: {
  secondSheet?: boolean;
  firstDraft?: string;
  secondDraft?: string;
  pendingFirst?: boolean;
  firstSaveable?: boolean;
}) {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  const [pending, setPending] = useState(pendingFirst);
  useLayoutEffect(() => {
    toggle = { first: setFirst, second: setSecond, pending: setPending };
  }, []);
  const secondContent = (
    <>
      <PageHeader title="Second heading" />
      <Form name="Second draft" initial={secondDraft} />
    </>
  );
  return (
    <DraftGuardProvider>
      <main>
        <PageHeader title="Building" />
        <Dialog open={first} onOpenChange={setFirst} backPending={pending}>
          <DialogContent data-testid="first-overlay">
            <DialogTitle>First overlay</DialogTitle>
            <DialogDescription>First mounted root</DialogDescription>
            <PageHeader title="First heading" />
            <Form
              name="First draft"
              initial={firstDraft}
              busy={pending}
              saveable={firstSaveable}
            />
          </DialogContent>
        </Dialog>
        {secondSheet ? (
          <Sheet open={second} onOpenChange={setSecond}>
            <SheetContent data-testid="second-overlay">
              <SheetTitle>Second overlay</SheetTitle>
              <SheetDescription>Second mounted root</SheetDescription>
              {secondContent}
            </SheetContent>
          </Sheet>
        ) : (
          <Dialog open={second} onOpenChange={setSecond}>
            <DialogContent data-testid="second-overlay">
              <DialogTitle>Second overlay</DialogTitle>
              <DialogDescription>Second mounted root</DialogDescription>
              {secondContent}
            </DialogContent>
          </Dialog>
        )}
      </main>
    </DraftGuardProvider>
  );
}
async function nativeBack() {
  await act(async () => {
    window.history.back();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}
async function nativeForward() {
  await act(async () => {
    window.history.forward();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}
async function reverseOpen(props: ComponentProps<typeof AlwaysMounted> = {}) {
  renderWithIntl(<AlwaysMounted {...props} />, {
    locale: "en",
    workspace: false,
  });
  act(() => toggle.second(true));
  await screen.findByRole("dialog", { name: "Second overlay" });
  act(() => toggle.first(true));
  await screen.findByRole("dialog", { name: "First overlay" });
  await waitFor(() =>
    expect(
      [...new URLSearchParams(window.location.search).keys()].filter((key) =>
        key.startsWith("overlay"),
      ),
    ).toHaveLength(2),
  );
}

describe("foreground activation and draft ownership", () => {
  it("discarding the foreground preserves the other dirty editor that remains mounted", async () => {
    await reverseOpen({ firstDraft: "abandon A", secondDraft: "retain B" });
    await nativeBack();
    await screen.findByRole("dialog", { name: "Save changes before leaving?" });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(screen.queryByTestId("first-overlay")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Second draft" })).toHaveValue(
      "retain B",
    );
  });
  it.each([false, true])(
    "native Back reverses activation order with always mounted roots (second Sheet %s)",
    async (secondSheet) => {
      await reverseOpen({ secondSheet });
      await nativeBack();
      await waitFor(() =>
        expect(screen.queryByTestId("first-overlay")).not.toBeInTheDocument(),
      );
      expect(
        screen.getByRole("dialog", { name: "Second overlay" }),
      ).toBeVisible();
      expect(window.location.pathname).toBe(
        "/en/master-data/storage-layouts/building-a",
      );
      await nativeBack();
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(window.location.pathname).toBe(
        "/en/master-data/storage-layouts/building-a",
      );
      await nativeBack();
      expect(window.location.pathname).toBe("/en/hr/profile");
    },
  );
  it("real PageBackButton in foreground dismisses the topmost and next Back dismisses remaining root", async () => {
    await reverseOpen();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "First overlay" })).getByRole(
        "button",
        { name: "Back" },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("first-overlay")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("dialog", { name: "Second overlay" }),
    ).toBeVisible();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Second overlay" })).getByRole(
        "button",
        { name: "Back" },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe(
      "/en/master-data/storage-layouts/building-a",
    );
  });
  it("native Back dismisses clean current review while retaining dirty earlier editor opened in reverse mount order", async () => {
    await reverseOpen({ secondDraft: "unsent underlay" });
    await nativeBack();
    await waitFor(() =>
      expect(screen.queryByTestId("first-overlay")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("dialog", {
        name: /Save changes before leaving|Leave without sending/,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Second overlay" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Second draft" })).toHaveValue(
      "unsent underlay",
    );
    expect(window.location.pathname).toBe(
      "/en/master-data/storage-layouts/building-a",
    );
  });
  it("native Back cannot silently discard foreground dirty form when previous root mounted later", async () => {
    await reverseOpen({ firstDraft: "unsent foreground" });
    await nativeBack();
    await screen.findByRole("dialog", {
      name: /Save changes before leaving|Leave without sending/,
    });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "First overlay" }),
      ).toBeVisible(),
    );
    expect(screen.getByRole("textbox", { name: "First draft" })).toHaveValue(
      "unsent foreground",
    );
  });
  it("pending topmost overlay cannot be discarded or lose its foreground through native Back", async () => {
    await reverseOpen({ pendingFirst: true });
    const originalSearch = window.location.search;
    await nativeBack();
    await waitFor(() =>
      expect(screen.getByTestId("first-overlay")).toBeInTheDocument(),
    );
    const prompt = screen.queryByTestId("navigation-guard-pending");
    if (prompt) {
      expect(
        screen.getByRole("button", { name: "Discard changes" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    }
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "First overlay" }),
      ).toBeVisible(),
    );
    await waitFor(() => expect(window.location.search).toBe(originalSearch));
    expect(window.location.pathname).toBe(
      "/en/master-data/storage-layouts/building-a",
    );
    expect(screen.getByTestId("second-overlay")).toBeInTheDocument();
  });
  it("clean native Forward reopens only the dismissed topmost overlay without duplicate entries", async () => {
    await reverseOpen();
    const search = window.location.search;
    const length = window.history.length;
    await nativeBack();
    await waitFor(() =>
      expect(screen.queryByTestId("first-overlay")).not.toBeInTheDocument(),
    );
    await nativeForward();
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "First overlay" }),
      ).toBeVisible(),
    );
    expect(window.location.search).toBe(search);
    expect(window.history.length).toBe(length);
  });
});

function NestedCaller() {
  const [editor, setEditor] = useState(false);
  const [review, setReview] = useState(false);
  return (
    <DraftGuardProvider>
      <main>
        <PageHeader title="Building" />
        <button onClick={() => setEditor(true)}>Edit plan</button>
        <Dialog open={editor} onOpenChange={setEditor}>
          <DialogContent data-testid="editor">
            <DialogTitle>Editor</DialogTitle>
            <DialogDescription>Edit floor</DialogDescription>
            <Form name="Plan draft" />
            <button onClick={() => setReview(true)}>Review</button>
            <Dialog open={review} onOpenChange={setReview}>
              <DialogContent data-testid="review">
                <DialogTitle>Review</DialogTitle>
                <DialogDescription>Review plan</DialogDescription>
              </DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      </main>
    </DraftGuardProvider>
  );
}
it("actual nested lazy portal review dismisses while retaining dirty parent editor, then parent close is guarded", async () => {
  renderWithIntl(<NestedCaller />, { locale: "en", workspace: false });
  fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Plan draft" }), {
    target: { value: "keep this floor" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await waitFor(() =>
    expect(
      [...new URLSearchParams(window.location.search).keys()].filter((key) =>
        key.startsWith("overlay"),
      ),
    ).toHaveLength(2),
  );
  await nativeBack();
  await waitFor(() =>
    expect(screen.queryByTestId("review")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("dialog", { name: "Editor" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Plan draft" })).toHaveValue(
    "keep this floor",
  );
  await nativeBack();
  await screen.findByRole("dialog", { name: "Save changes before leaving?" });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Plan draft" })).toHaveValue(
    "keep this floor",
  );
});

it("foreground Save and continue ignores the retained dirty underlay when offering its sole save", async () => {
  await reverseOpen({
    firstDraft: "save this area",
    secondDraft: "retain floor",
    firstSaveable: true,
  });
  await nativeBack();
  const save = await screen.findByRole("button", { name: "Save and continue" });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() =>
    expect(screen.queryByTestId("first-overlay")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("textbox", { name: "Second draft" })).toHaveValue(
    "retain floor",
  );
});
