import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { expect, it } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

function Draft({ title }: { readonly title: string }) {
  const t = useTranslations("App");
  const [value, setValue] = useState("");
  return (
    <>
      <h1>{title}</h1>
      <input
        aria-label={t("close")}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </>
  );
}

it("preserves translations and local draft state across a bare rerender", () => {
  const view = renderWithIntl(<Draft title="Before" />, {
    locale: "en",
    preserveProviders: true,
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Close" }), {
    target: { value: "unsaved" },
  });
  view.rerender(<Draft title="After" />);
  expect(screen.getByRole("heading", { name: "After" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Close" })).toHaveValue("unsaved");
});
