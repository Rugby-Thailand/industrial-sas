import { act, fireEvent, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import { guardedNavigate } from "@/lib/navigationGuard";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  query: undefined as unknown,
  queryCalls: [] as string[],
  save: vi.fn(),
  access: {} as Record<string, unknown>,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0]) => {
      const key = name(reference);
      state.queryCalls.push(key);
      return key === "hr/preferences:current" ? state.query : undefined;
    },
    useMutation: (reference: Parameters<typeof name>[0]) => {
      if (name(reference) !== "hr/preferences:save")
        throw new Error(`Unexpected mutation ${name(reference)}`);
      return state.save;
    },
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

import { HrShortcutCustomizeScreen } from "./ShortcutCustomizeScreen";
import type { HrShortcutPreference } from "./HrShortcuts";

const KEYS = [
  "hr.today",
  "hr.time",
  "hr.requests",
  "hr.holidays",
  "hr.profile",
];
const defaults = () => KEYS.map((key) => ({ key, visible: true }));
const query = (shortcuts = defaults(), version = 0) => ({
  ok: true,
  requestId: "preferences-query",
  value: { ok: true, shortcuts, version },
});
const saved = (shortcuts: readonly HrShortcutPreference[], version = 1) => ({
  ok: true,
  requestId: "preferences-write",
  value: {
    written: true,
    documentId: "preferences-document",
    version,
    shortcuts,
  },
});
const list = () => screen.getByRole("list", { name: "Shortcut order" });
const order = () =>
  within(list())
    .getAllByRole("listitem")
    .map((row) => row.getAttribute("data-shortcut-key"));
const handle = (label = "Today") =>
  within(list()).getByRole("button", {
    name: new RegExp(`^Reorder ${label},`),
  });
const show = (label = "Today") =>
  within(list()).getByRole("checkbox", { name: `Show ${label}` });
const saveButton = () => screen.getByRole("button", { name: "Save" });
const cancelButton = () => screen.getByRole("button", { name: "Cancel" });

function Harness() {
  return (
    <DraftGuardProvider>
      <main tabIndex={-1}>
        <HrShortcutCustomizeScreen />
      </main>
    </DraftGuardProvider>
  );
}
function start() {
  return renderWithIntl(<Harness />, {
    locale: "en",
    preserveProviders: true,
  });
}
function key(button: HTMLElement, pressed: string) {
  act(() => button.focus());
  fireEvent.keyDown(button, { key: pressed });
}

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 7;
    this.isPrimary = init.isPrimary ?? true;
  }
}
function setupPointer() {
  const captured = new Set<number>();
  const capture = vi
    .spyOn(Element.prototype, "setPointerCapture")
    .mockImplementation((id) => {
      captured.add(id);
    });
  vi.spyOn(Element.prototype, "hasPointerCapture").mockImplementation((id) =>
    captured.has(id),
  );
  const release = vi
    .spyOn(Element.prototype, "releasePointerCapture")
    .mockImplementation((id) => {
      captured.delete(id);
    });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const index = this.dataset.shortcutKey
        ? [...list().children].indexOf(this)
        : 0;
      const top = this.tagName === "MAIN" ? 0 : 40 + index * 50;
      const height = this.tagName === "MAIN" ? 300 : 50;
      return DOMRect.fromRect({ x: 0, y: top, width: 500, height });
    },
  );
  return { capture, release, captured };
}
function pointerDown(button: HTMLElement) {
  fireEvent.pointerDown(button, {
    button: 0,
    pointerId: 7,
    isPrimary: true,
    clientY: 60,
  });
}
function pointerMove(button: HTMLElement, clientY = 290) {
  fireEvent.pointerMove(button, { pointerId: 7, clientY });
}

beforeEach(() => {
  state.access = {
    status: "READY",
    permissions: ["hr.self.access"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    identityKey: "org-a:user-a",
    sites: [],
  };
  state.query = query();
  state.queryCalls.length = 0;
  state.save
    .mockReset()
    .mockImplementation(
      async (args: {
        readonly expectedVersion: number;
        readonly shortcuts: readonly HrShortcutPreference[];
      }) => saved(args.shortcuts, args.expectedVersion + 1),
    );
  sessionStorage.clear();
  window.history.replaceState(null, "", "/en/hr/customize");
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("shortcut preference editing", () => {
  it("persists visibility and order for the permitted menus and restores saved query data", async () => {
    const view = start();
    expect(order()).toEqual(KEYS);
    expect(saveButton()).toBeDisabled();
    fireEvent.click(show("Attendance history"));
    const profile = handle("Profile");
    key(profile, "Enter");
    key(profile, "Home");
    key(profile, " ");
    expect(profile).toHaveFocus();
    fireEvent.click(saveButton());

    await screen.findByText("Shortcut preferences saved.");
    const command = state.save.mock.calls[0]![0];
    expect(command).toEqual({
      requestId: expect.any(String),
      expectedVersion: 0,
      shortcuts: [
        { key: "hr.profile", visible: true },
        { key: "hr.today", visible: true },
        { key: "hr.time", visible: false },
        { key: "hr.requests", visible: true },
        { key: "hr.holidays", visible: true },
      ],
    });
    expect(saveButton()).toBeDisabled();
    view.unmount();
    state.query = query(command.shortcuts, 1);
    start();
    expect(order()).toEqual(
      command.shortcuts.map((item: HrShortcutPreference) => item.key),
    );
    expect(show("Attendance history")).not.toBeChecked();
    expect(saveButton()).toBeDisabled();
    expect(getFunctionName(hrRefs.shortcutPreferences)).toBe(
      "hr/preferences:current",
    );
  });

  it.each(["Enter", " "])(
    "lifts and drops with %s, moves with arrows/Home/End and keeps its handle focused",
    (lift) => {
      start();
      const today = handle();
      key(today, lift);
      expect(today).toHaveAttribute("aria-pressed", "true");
      expect(show()).toBeDisabled();
      expect(saveButton()).toBeDisabled();
      key(today, "ArrowDown");
      expect(order()[1]).toBe("hr.today");
      expect(today).toHaveFocus();
      key(today, "ArrowRight");
      expect(order()[2]).toBe("hr.today");
      key(today, "ArrowLeft");
      key(today, "ArrowUp");
      expect(order()).toEqual(KEYS);
      key(today, "End");
      expect(order().at(-1)).toBe("hr.today");
      key(today, "Home");
      expect(order()).toEqual(KEYS);
      key(today, "ArrowDown");
      key(today, lift);
      expect(today).toHaveAttribute("aria-pressed", "false");
      expect(today).toHaveFocus();
      expect(show()).toBeEnabled();
      expect(saveButton()).toBeEnabled();
    },
  );

  it("Escape restores only the current move and Cancel restores the persisted menus", () => {
    start();
    fireEvent.click(show("Profile"));
    const today = handle();
    key(today, "Enter");
    key(today, "End");
    key(today, "Escape");
    expect(order()).toEqual(KEYS);
    expect(show("Profile")).not.toBeChecked();
    expect(today).toHaveFocus();
    expect(saveButton()).toBeEnabled();
    fireEvent.click(cancelButton());
    expect(show("Profile")).toBeChecked();
    expect(saveButton()).toBeDisabled();
    expect(today).toHaveFocus();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("supports assistive virtual activation of a reorder handle", () => {
    start();
    const today = handle();
    fireEvent.click(today, { detail: 0 });
    expect(today).toHaveAttribute("aria-pressed", "true");
    key(today, "ArrowDown");
    fireEvent.click(today, { detail: 0 });
    expect(today).toHaveAttribute("aria-pressed", "false");
    expect(order()[1]).toBe("hr.today");
    expect(today).toHaveFocus();
  });

  it("keeps the saved receipt authoritative when Cancel precedes the reactive query update", async () => {
    start();
    fireEvent.click(show("Profile"));
    fireEvent.click(saveButton());
    await screen.findByText("Shortcut preferences saved.");
    fireEvent.click(show("Attendance history"));
    fireEvent.click(cancelButton());
    expect(show("Profile")).not.toBeChecked();
    expect(show("Attendance history")).toBeChecked();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(show("Attendance history"));
    fireEvent.click(saveButton());
    await screen.findByText("Shortcut preferences saved.");
    expect(state.save.mock.calls[1]![0].expectedVersion).toBe(1);
  });
});

describe("pointer sorting", () => {
  it("moves the dragged menu from row measurements and keeps focus after dropping", () => {
    start();
    const capture = setupPointer();
    const today = handle();
    pointerDown(today);
    expect(capture.capture.mock.contexts[0]).toBe(list());
    pointerMove(list());
    expect(order().at(-1)).toBe("hr.today");
    expect(today).toHaveFocus();
    fireEvent.pointerUp(list(), { pointerId: 7 });
    expect(today).toHaveAttribute("aria-pressed", "false");
    expect(today).toHaveFocus();
    expect(capture.release).toHaveBeenCalledWith(7);
    expect(saveButton()).toBeEnabled();
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])(
    "restores the starting draft and handle focus after %s",
    (event) => {
      start();
      setupPointer();
      fireEvent.click(show("Profile"));
      const today = handle();
      pointerDown(today);
      pointerMove(today);
      expect(order().at(-1)).toBe("hr.today");
      if (event === "blur") fireEvent.blur(window);
      else
        fireEvent(
          today,
          new TestPointerEvent(event, { pointerId: 7, bubbles: true }),
        );
      expect(order()).toEqual(KEYS);
      expect(show("Profile")).not.toBeChecked();
      expect(today).toHaveFocus();
      expect(today).toHaveAttribute("aria-pressed", "false");
    },
  );

  it("scrolls the overflowing main landmark during dragging and stops after cancellation", () => {
    start();
    setupPointer();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        frames.delete(id);
      });
    const main = screen.getByRole("main");
    document.documentElement.scrollTop = 0;
    const today = handle();
    pointerDown(today);
    pointerMove(today, 290);
    const first = [...frames.entries()][0]!;
    act(() => {
      frames.delete(first[0]);
      first[1](0);
    });
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(document.documentElement.scrollTop).toBe(0);
    fireEvent.pointerCancel(today, { pointerId: 7 });
    expect(cancel).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("releases active pointer capture when the editor unmounts", () => {
    const view = start();
    const capture = setupPointer();
    pointerDown(handle());
    expect(capture.captured.has(7)).toBe(true);
    view.unmount();
    expect(capture.release).toHaveBeenCalledWith(7);
    expect(capture.captured.has(7)).toBe(false);
  });
});

describe("write recovery and identity", () => {
  it("locks pending controls and prevents discarding or leaving until the write settles", async () => {
    let answer!: (value: unknown) => void;
    state.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    start();
    fireEvent.click(show("Profile"));
    fireEvent.click(saveButton());
    expect(screen.getByText("Saving…")).toBeVisible();
    expect(show()).toBeDisabled();
    expect(handle()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    const leave = vi.fn();
    act(() => guardedNavigate(leave));
    expect(await screen.findByTestId("navigation-guard-pending")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await act(async () =>
      answer(saved(state.save.mock.calls[0]![0].shortcuts)),
    );
    await screen.findByText("Shortcut preferences saved.");
    expect(show()).toBeEnabled();
    act(() => guardedNavigate(leave));
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(leave).toHaveBeenCalledOnce();
  });

  it("pins the exact payload and request ID after an uncertain response even if the live query changes", async () => {
    state.save.mockRejectedValueOnce(new Error("Response lost"));
    const view = start();
    fireEvent.click(show("Profile"));
    fireEvent.click(saveButton());
    await screen.findByTestId("hr-write-uncertain");
    expect(show()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(handle()).toBeDisabled();
    const original = structuredClone(state.save.mock.calls[0]![0]);
    state.query = query(defaults().reverse(), 8);
    view.rerender(<Harness />);
    expect(order()).toEqual(KEYS);
    fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
    await screen.findByText("Shortcut preferences saved.");
    expect(state.save.mock.calls[1]![0]).toEqual(original);
    // A newer query remains authoritative after the older command receipt.
    expect(show("Profile")).toBeChecked();
    expect(order()).toEqual([...KEYS].reverse());
    fireEvent.click(show("Profile"));
    fireEvent.click(saveButton());
    expect(state.save.mock.calls[2]![0].expectedVersion).toBe(8);
  });

  it("treats a success without saved preference extras as uncertain rather than discarding the draft", async () => {
    state.save.mockResolvedValueOnce({
      ok: true,
      value: { written: true, documentId: "document" },
    });
    start();
    fireEvent.click(show("Profile"));
    fireEvent.click(saveButton());
    await screen.findByTestId("hr-write-uncertain");
    expect(show("Profile")).not.toBeChecked();
    expect(cancelButton()).toBeDisabled();
    expect(screen.queryByText("Shortcut preferences saved.")).toBeNull();
  });

  it("refuses to confirm a saved response containing a destination outside the shortcut allowlist", async () => {
    state.save.mockResolvedValueOnce(
      saved([{ key: "https://outside.example", visible: true }]),
    );
    start();
    fireEvent.click(show("Profile"));
    fireEvent.click(saveButton());
    await screen.findByTestId("hr-write-uncertain");
    expect(show("Profile")).not.toBeChecked();
    expect(screen.queryByText("Shortcut preferences saved.")).toBeNull();
    expect(
      screen.queryByRole("link", { name: "https://outside.example" }),
    ).toBeNull();
  });

  it("preserves a refused draft and lets Cancel load the newest query version before resaving", async () => {
    state.save.mockResolvedValueOnce({
      ok: true,
      value: { written: false, error: { code: "PREFERENCES_STALE" } },
    });
    const view = start();
    fireEvent.click(show("Profile"));
    fireEvent.click(saveButton());
    await screen.findByTestId("hr-shortcuts-stale");
    expect(show("Profile")).not.toBeChecked();
    expect(
      screen.getByText("Your shortcuts changed in another session."),
    ).toBeVisible();
    const newest = defaults()
      .reverse()
      .map((item) => ({ ...item, visible: item.key !== "hr.today" }));
    state.query = query(newest, 3);
    view.rerender(<Harness />);
    expect(order()).toEqual(KEYS);
    fireEvent.click(cancelButton());
    expect(order()).toEqual([...KEYS].reverse());
    expect(show("Profile")).toBeChecked();
    expect(show()).not.toBeChecked();
    expect(screen.queryByTestId("hr-shortcuts-stale")).toBeNull();
    fireEvent.click(show());
    fireEvent.click(saveButton());
    await screen.findByText("Shortcut preferences saved.");
    expect(state.save.mock.calls[1]![0].expectedVersion).toBe(3);
  });

  it.each([
    [
      "en",
      "Show Profile",
      "Save",
      "Your shortcuts changed in another session.",
      "Cancel to load the current preferences, then make your changes again.",
      ["Try again", "correct it and try again"],
    ],
    [
      "th",
      "แสดง โปรไฟล์",
      "บันทึก",
      "เมนูลัดของคุณเปลี่ยนจากอีกเซสชัน",
      "กดยกเลิกเพื่อโหลดเมนูล่าสุด แล้วแก้ไขอีกครั้ง",
      ["กรุณาลองใหม่", "แก้ไขแล้วลองใหม่ได้"],
    ],
  ] as const)(
    "shows one %s conflict notice with the actual recovery step for a stale save",
    async (locale, profile, save, title, hint, generic) => {
      state.save.mockResolvedValue({
        ok: true,
        value: { written: false, error: { code: "PREFERENCES_STALE" } },
      });
      renderWithIntl(<Harness />, { locale, preserveProviders: true });
      const profileShown = () =>
        screen.getByRole("checkbox", { name: profile });
      fireEvent.click(profileShown());
      fireEvent.click(screen.getByRole("button", { name: save }));
      const notice = await screen.findByTestId("hr-shortcuts-stale");
      expect(screen.getAllByRole("alert")).toEqual([notice]);
      expect(notice).toHaveTextContent(title);
      expect(notice).toHaveTextContent(hint);
      expect(screen.queryByTestId("hr-write-refused")).toBeNull();
      for (const text of generic)
        expect(screen.queryByText(text, { exact: false })).toBeNull();
      // The draft is kept; saving again is refused again with the same notice.
      fireEvent.click(screen.getByRole("button", { name: save }));
      await vi.waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
      expect(await screen.findByTestId("hr-shortcuts-stale")).toBeVisible();
      expect(profileShown()).not.toBeChecked();
    },
  );

  it("keeps the generic refused feedback for other shortcut refusals", async () => {
    state.save.mockResolvedValueOnce({
      ok: true,
      value: { written: false, error: { code: "SOMETHING_ELSE" } },
    });
    start();
    fireEvent.click(show("Profile"));
    fireEvent.click(saveButton());
    expect(await screen.findByTestId("hr-write-refused")).toBeVisible();
    expect(screen.queryByTestId("hr-shortcuts-stale")).toBeNull();
  });

  it("clears the old actor's draft and ignores their delayed saved result after identity changes", async () => {
    let answer!: (value: unknown) => void;
    state.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const view = start();
    fireEvent.click(show("Profile"));
    fireEvent.click(saveButton());
    const oldDraft = state.save.mock.calls[0]![0].shortcuts;
    state.access.identityKey = "org-b:user-b";
    state.query = query(defaults().reverse(), 7);
    view.rerender(<Harness />);
    expect(order()).toEqual([...KEYS].reverse());
    expect(show("Profile")).toBeChecked();
    expect(show()).toBeEnabled();
    await act(async () => answer(saved(oldDraft)));
    expect(order()).toEqual([...KEYS].reverse());
    expect(show("Profile")).toBeChecked();
    expect(screen.queryByText("Shortcut preferences saved.")).toBeNull();
  });
});

describe("preference read gates", () => {
  it.each([
    ["loading", undefined],
    ["denied", { ok: false, requestId: "denied-preferences" }],
    [
      "not linked",
      {
        ok: true,
        requestId: "not-linked",
        value: { ok: false, code: "HR_NOT_LINKED" },
      },
    ],
  ])(
    "does not invent default menus when the preferences query is %s",
    (_label, outcome) => {
      state.query = outcome;
      start();
      expect(screen.queryByRole("list", { name: "Shortcut order" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      expect(state.save).not.toHaveBeenCalled();
    },
  );

  it("does not query preferences through a denied HR access gate", () => {
    state.access.permissions = [];
    start();
    expect(screen.getByTestId("hr-denied")).toBeVisible();
    expect(state.queryCalls).toEqual([]);
    expect(screen.queryByRole("list", { name: "Shortcut order" })).toBeNull();
  });
});
