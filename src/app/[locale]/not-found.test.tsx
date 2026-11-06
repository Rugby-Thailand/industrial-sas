import { fireEvent, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messagesFor } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const request = vi.hoisted(() => ({
  locale: "th" as AppLocale,
  replace: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: request.locale,
      messages: messagesFor(request.locale),
      namespace: namespace as never,
    }),
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/no-such-page",
  useRouter: () => ({ replace: request.replace }),
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));

import LocaleNotFound from "./not-found";

async function renderNotFound(locale: AppLocale) {
  request.locale = locale;
  renderWithIntl(await LocaleNotFound(), { locale, workspace: false });
}

const originalUrl = window.location.href;
beforeEach(() => request.replace.mockReset());
afterEach(() => window.history.replaceState(null, "", originalUrl));

describe("locale not-found page", () => {
  it.each([
    [
      "th",
      "ไม่พบหน้าที่ต้องการ",
      "ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายหรือลบไปแล้ว ตรวจลิงก์อีกครั้ง หรือไปหน้าเริ่มต้นแล้วเลือกจากเมนู",
      "ไปหน้าเริ่มต้น",
    ],
    [
      "en",
      "Page not found",
      "The link may be mistyped, or the page may have moved or been removed. Check the link, or go to the start page and pick from the menu.",
      "Go to start page",
    ],
  ] as const)(
    "asks a %s reader to check the link and offers the start page",
    async (locale, title, body, action) => {
      await renderNotFound(locale);
      expect(
        screen.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
      expect(screen.getByText(body)).toBeVisible();
      expect(screen.queryByText(/ที่อยู่|address/)).toBeNull();
      expect(screen.getByRole("link", { name: action })).toHaveAttribute(
        "href",
        "/master-data/storage-layouts",
      );
    },
  );

  it.each([
    ["th", "เปลี่ยนภาษาเป็น English", "en"],
    ["en", "Switch language to ไทย", "th"],
  ] as const)(
    "opens the same address in the other language from a %s page",
    async (locale, name, next) => {
      window.history.replaceState(
        null,
        "",
        `/${locale}/no-such-page?from=mail#top`,
      );
      await renderNotFound(locale);

      fireEvent.click(screen.getByRole("button", { name }));

      expect(request.replace).toHaveBeenCalledExactlyOnceWith(
        "/no-such-page?from=mail#top",
        { locale: next },
      );
    },
  );
});
