import { act, fireEvent, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ObservabilityProvider } from "@/components/providers/ObservabilityProvider";
import type { ObservabilityEvent } from "@/lib/observability/event";
import type { ObservabilityPort } from "@/lib/observability/port";
import { APPLICATION_RENDER_ERROR_CODE } from "@/lib/observability/applicationError";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const STORAGE = "masterData.storageLayout.read";
const HR_SELF = "hr.self.access";
const HR_REVIEW = "hr.team.review";

const navigation = vi.hoisted(() => ({ pathname: "/finished-goods" }));
// The member's grants; `null` is a source that is still loading.
const access = vi.hoisted(() => ({
  storage: [] as string[] | null,
  hr: [] as string[] | null,
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    permissionsReady: access.storage !== null && access.storage.length > 0,
    navigationPermissions: access.storage ?? [],
    // An empty storage grant is an HR-only member's settled denial.
    denied: access.storage?.length === 0,
    failed: false,
  }),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () =>
    access.hr === null
      ? { status: "LOADING", permissions: [] }
      : { status: "READY", permissions: access.hr },
}));
vi.mock("@/components/providers/AiUsageAccessProvider", () => ({
  useAiUsageAccess: () => ({ status: "NONE", permissions: [] }),
}));

import DesktopPageError from "./error";

const recordingPort = (): ObservabilityPort & {
  readonly events: ObservabilityEvent[];
} => {
  const events: ObservabilityEvent[] = [];
  return { events, record: (event) => void events.push(event) };
};

function renderError(
  locale: "th" | "en" = "th",
  error: Error & { digest?: string } = new Error(
    "productId not-a-real-id for tenant secret",
  ),
) {
  const port = recordingPort();
  const retry = vi.fn();
  renderWithIntl(
    <ObservabilityProvider port={port}>
      <DesktopPageError error={error} retry={retry} />
    </ObservabilityProvider>,
    { locale },
  );
  return { port, retry };
}

beforeEach(() => {
  navigation.pathname = "/finished-goods";
  access.storage = [STORAGE];
  access.hr = [HR_SELF, HR_REVIEW];
});

describe("desktop page error boundary", () => {
  it("names the failed page, retries first and offers its module hub second", () => {
    navigation.pathname = "/finished-goods/products/not-a-real-id";
    const { port, retry } = renderError();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "เปิดหน้านี้ไม่ได้" }),
    ).toBeVisible();
    // The failed page keeps its place under the module page above it.
    const trail = screen.getByRole("navigation", { name: "เส้นทางหน้า" });
    expect(
      within(trail).getByRole("link", { name: "สินค้าสำเร็จรูป" }),
    ).toHaveAttribute("href", "/finished-goods");
    // An unclassified read failure: neutral words, no guesses, and three
    // different facts: what failed, that it may pass, what else to do.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("โหลดข้อมูลไม่สำเร็จ อาจเป็นปัญหาชั่วคราว");
    expect(alert).toHaveTextContent(
      "ข้อมูลที่บันทึกไว้ไม่ได้รับผลกระทบ หากยังเปิดไม่ได้ โปรดแจ้งผู้ดูแลองค์กร",
    );
    expect(alert).not.toHaveTextContent(/ลิงก์|ถูกลบ|เปิดหน้านี้ไม่ได้/);
    // The buttons name the next steps; the notice does not repeat them.
    expect(alert).not.toHaveTextContent(/ลองใหม่|สินค้าสำเร็จรูป/);
    const again = screen.getByRole("button", { name: "ลองใหม่" });
    expect(again).toHaveAttribute("data-variant", "default");
    const hub = screen.getByRole("link", { name: "ไปที่หน้าสินค้าสำเร็จรูป" });
    expect(hub).toHaveAttribute("href", "/finished-goods");
    expect(hub).toHaveAttribute("data-variant", "outline");
    // The retry comes before the hub in reading and tab order.
    expect(
      again.compareDocumentPosition(hub) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(again);
    expect(retry).toHaveBeenCalledOnce();
    expect(port.events).toHaveLength(1);
    expect(port.events[0]).toMatchObject({
      code: APPLICATION_RENDER_ERROR_CODE,
      severity: "error",
    });
    expect(JSON.stringify(port.events)).not.toContain("tenant secret");
  });

  it.each([
    ["/finished-goods/scan", "/finished-goods", "Finished goods"],
    ["/hr/leave/review/request-1", "/hr/leave/review", "Review leave"],
    ["/hr/today", "/master-data/storage-layouts", "Buildings & spots"],
  ])(
    "sends a failure at %s to %s, never to the failed page itself",
    (pathname, href, hub) => {
      navigation.pathname = pathname;
      renderError("en");

      expect(
        screen.getByRole("link", { name: `Go to ${hub}` }),
      ).toHaveAttribute("href", href);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This page's data didn't load. This may be temporary.",
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent(hub);
    },
  );

  it.each([
    // The parent the member may open, not the review queue they may not.
    ["/hr/leave/review/request-1", "/hr/leave", "Leave", "Leave"],
    // Their own start page, never Buildings & spots, which would redirect.
    ["/hr/customize", "/hr/today", "Today", undefined],
  ])(
    "chooses the way out of %s from an HR-only member's own menu: %s",
    (pathname, href, name, crumb) => {
      access.storage = [];
      access.hr = [HR_SELF];
      navigation.pathname = pathname;
      renderError("en");

      expect(
        screen.getByRole("link", { name: `Go to ${name}` }),
      ).toHaveAttribute("href", href);
      expect(
        screen.queryByRole("link", { name: /Buildings & spots/ }),
      ).toBeNull();
      const trail = screen.queryByRole("navigation", { name: "Breadcrumb" });
      if (crumb === undefined) expect(trail).toBeNull();
      else
        expect(
          within(trail!).getByRole("link", { name: crumb }),
        ).toHaveAttribute("href", href);
    },
  );

  it("offers retry alone when an HR-only member's start page failed, rather than a page that redirects back to it", () => {
    access.storage = [];
    access.hr = [HR_SELF];
    navigation.pathname = "/hr/today";
    renderError("en");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("names the start page neutrally while the member's access is still loading", () => {
    access.storage = null;
    access.hr = null;
    navigation.pathname = "/hr/customize";
    renderError();

    expect(
      screen.getByRole("link", { name: "ไปหน้าเริ่มต้น" }),
    ).toHaveAttribute("href", "/master-data/storage-layouts");
  });

  it("offers retry as the only action when the start page itself failed", () => {
    navigation.pathname = "/master-data/storage-layouts";
    renderError("en");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute(
      "data-variant",
      "default",
    );
    // No destination to name: the copy still says what else to do.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nothing you saved is affected. If it still won't open, tell your organization administrator and quote the reference below.",
    );
  });
});

describe("desktop page error reference", () => {
  const AT = new Date("2026-11-05T05:40:00Z");
  const time = (locale: "th" | "en") =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok",
    }).format(AT);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(AT);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gives a reference to quote with the page and time, and records the same reference with the route pattern", () => {
    const { port } = renderError();

    const group = screen.getByRole("group", { name: "รหัสอ้างอิง" });
    const code = within(group).getByTestId("route-error-reference-code");
    expect(code.textContent).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(
      within(group).getByTestId("route-error-reference-detail"),
    ).toHaveTextContent(`สินค้าสำเร็จรูป · ${time("th")}`);
    // It follows the actions, outside the alert, which still names no page.
    expect(screen.getByRole("alert")).not.toContainElement(group);
    expect(port.events).toEqual([
      expect.objectContaining({
        occurredAt: AT.getTime(),
        dimensions: {
          boundary: "locale",
          reference: code.textContent,
          route: "th.finished-goods",
        },
      }),
    ]);
    expect(JSON.stringify(port.events)).not.toContain("tenant secret");
  });

  it("quotes a server error by its digest and a detail page by its menu row, with its address in the copy", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    navigation.pathname = "/finished-goods/products/not-a-real-id";
    const error = Object.assign(new Error("hidden"), { digest: "2338461745" });
    const { port } = renderError("en", error);

    expect(screen.getByTestId("route-error-reference-code")).toHaveTextContent(
      "2338461745",
    );
    expect(
      screen.getByTestId("route-error-reference-detail"),
    ).toHaveTextContent(`Finished goods · ${time("en")}`);
    expect(port.events[0]?.dimensions).toEqual({
      boundary: "locale",
      reference: "2338461745",
      route: "en.finished-goods.products.[id]",
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      `Reference 2338461745 · Finished goods · /finished-goods/products/not-a-real-id · ${time("en")}`,
    );
  });

  it("names a page outside the menu by its address", () => {
    access.storage = [];
    access.hr = [HR_SELF];
    navigation.pathname = "/hr/customize";
    renderError("en");

    expect(
      screen.getByTestId("route-error-reference-detail"),
    ).toHaveTextContent(`/hr/customize · ${time("en")}`);
  });

  it("copies the reference, page and time as one line and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderError();
    const code = screen.getByTestId("route-error-reference-code").textContent;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "คัดลอก" }));
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      `รหัสอ้างอิง ${code} · สินค้าสำเร็จรูป · /finished-goods · ${time("th")}`,
    );
    expect(screen.getByRole("button", { name: "คัดลอกแล้ว" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("คัดลอกแล้ว");
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button", { name: "คัดลอก" })).toBeVisible();
  });

  it("shows a running retry briefly and keeps focus on it, so a retry that fails again is not a dead button", () => {
    const { retry } = renderError();
    const again = screen.getByRole("button", { name: "ลองใหม่" });
    again.focus();

    fireEvent.click(again);
    expect(retry).toHaveBeenCalledOnce();
    expect(again).toHaveAttribute("aria-busy", "true");
    expect(again).toHaveAttribute("aria-disabled", "true");
    expect(again).toHaveFocus();
    fireEvent.click(again);
    expect(retry).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(800));
    expect(again).not.toHaveAttribute("aria-busy");
    expect(again).not.toHaveAttribute("aria-disabled");
    fireEvent.click(again);
    expect(retry).toHaveBeenCalledTimes(2);
  });
});
