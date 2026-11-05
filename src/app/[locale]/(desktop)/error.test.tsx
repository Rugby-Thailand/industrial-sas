import { fireEvent, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function renderError(locale: "th" | "en" = "th") {
  const port = recordingPort();
  const retry = vi.fn();
  renderWithIntl(
    <ObservabilityProvider port={port}>
      <DesktopPageError
        error={new Error("productId not-a-real-id for tenant secret")}
        retry={retry}
      />
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
        "Its data didn't load. This may be temporary.",
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
      "Nothing you saved is affected. If it still won't open, tell your organization administrator.",
    );
  });
});
