import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const directory = "docs/previews/line-hr-onboarding-2026-10-13";
const read = (file: string) => readFileSync(resolve(directory, file), "utf8");
const key = "industrial-line-hr-preview-v1";

function mount(hash = "#/connection", stored: unknown = null) {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = read("index.html");
  const location = new URL(`https://preview.example/index.html${hash}`);
  const listeners = new Map<string, () => void>();
  const entries: { url: string; state: Record<string, unknown> | null }[] = [
    { url: location.href, state: null },
  ];
  let index = 0;
  const history = {
    state: null as Record<string, unknown> | null,
    pushState(state: Record<string, unknown>, _: string, url: string) {
      entries.splice(index + 1);
      entries.push({ url: new URL(url, location).href, state });
      index++;
      location.href = entries[index]!.url;
      this.state = state;
    },
    replaceState(state: Record<string, unknown>, _: string, url: string) {
      location.href = new URL(url, location).href;
      entries[index] = { url: location.href, state };
      this.state = state;
    },
    go(delta: number) {
      index = Math.max(0, Math.min(entries.length - 1, index + delta));
      location.href = entries[index]!.url;
      this.state = entries[index]!.state;
      listeners.get("popstate")?.();
    },
    back() {
      this.go(-1);
    },
  };
  const storage = new Map([[key, JSON.stringify(stored)]]);
  const setItem = vi.fn((name: string, value: string) =>
    storage.set(name, value),
  );
  const dialog = doc.getElementById("dialog") as HTMLDialogElement;
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => dialog.removeAttribute("open");
  const errors = vi.fn();
  runInNewContext(read("app.js"), {
    document: doc,
    location,
    history,
    window: {
      addEventListener: (name: string, callback: () => void) =>
        listeners.set(name, callback),
      scrollTo: vi.fn(),
    },
    sessionStorage: { getItem: (name: string) => storage.get(name), setItem },
    console: { error: errors },
    URLSearchParams,
    FormData,
    setTimeout,
    clearTimeout,
  });
  const click = (selector: string) => {
    const element = doc.querySelector<HTMLElement>(selector);
    expect(element, selector).not.toBeNull();
    element!.click();
  };
  return { doc, location, history, setItem, storage, click, errors };
}

afterEach(() => vi.useRealTimers());

describe("onboarding preview security boundaries", () => {
  it.each(["__proto__", "constructor", "toString"])(
    "does not dispatch an inherited page named %s",
    (page) => {
      const { doc, errors } = mount(`#/${page}`);
      expect(doc.querySelector("h1")?.textContent).toBe(
        "ไม่พบหน้าหรือข้อมูลนี้",
      );
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it.each([
    "connection",
    "bot",
    "employees",
    "employees/link?id=e2",
    "cards",
    "cards/edit?id=meeting",
    "send",
    "tracking",
    "tracking/detail?id=p1",
    "employee/home",
    "employee/chat",
    "employee/profile",
    "employee/link",
    "employee/message?id=p1",
    "inbox",
    "flow",
  ])("renders the supported page %s", (page) => {
    const { doc, errors } = mount(`#/${page}`);
    expect(doc.querySelector("h1")).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("replaces legacy stored employee, credential and draft data with validated display preferences", () => {
    const payload = '<img id="injected" src=x onerror=alert(1)>';
    const { doc, storage } = mount("#/connection", {
      version: 1,
      scenario: payload,
      theme: payload,
      employees: [{ id: "e2", name: payload }],
      connection: { name: payload },
      drafts: { connection: { token: "private-token" } },
    });
    expect(JSON.parse(storage.get(key)!)).toEqual({
      version: 1,
      scenario: "ready",
      theme: "light",
    });
    expect(doc.getElementById("injected")).toBeNull();
    expect((doc.getElementById("oa-name") as HTMLInputElement).value).toBe(
      "SiamPack HR",
    );
  });

  it.each(["ready", "fresh", "outage"])(
    "preserves valid scenario and theme preferences for %s",
    (scenario) => {
      const { storage, doc } = mount("#/connection", {
        scenario,
        theme: "dark",
      });
      expect(JSON.parse(storage.get(key)!)).toEqual({
        version: 1,
        scenario,
        theme: "dark",
      });
      expect(doc.documentElement.dataset.theme).toBe("dark");
    },
  );

  it("keeps credential drafts in memory through cancelled navigation and clears them after discard", async () => {
    vi.useFakeTimers();
    const { doc, click, storage, history, errors } = mount();
    const input = doc.getElementById("access-token") as HTMLInputElement;
    input.value = "private-draft-token";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(storage.get(key)).not.toContain("private-draft-token");
    click('[data-route="bot"]');
    expect((doc.getElementById("dialog") as HTMLDialogElement).open).toBe(true);
    click('[data-action="dialog-choice"][data-choice="0"]');
    expect((doc.getElementById("access-token") as HTMLInputElement).value).toBe(
      "private-draft-token",
    );
    click('[data-route="bot"]');
    click('[data-action="dialog-choice"][data-choice="1"]');
    expect(doc.querySelector('form[data-form="bot"]')).not.toBeNull();
    history.back();
    expect((doc.getElementById("access-token") as HTMLInputElement).value).toBe(
      "DEMO-ACCESS-TOKEN",
    );
    await vi.runAllTimersAsync();
    expect(errors).not.toHaveBeenCalled();
  });

  it("normalizes a hostile scenario control value before resetting demo state", async () => {
    vi.useFakeTimers();
    const { doc, click, storage, errors } = mount();
    const select = doc.getElementById("scenario") as HTMLSelectElement;
    const option = doc.createElement("option");
    option.value = '<img id="injected" src=x>';
    select.append(option);
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    click('[data-action="dialog-choice"][data-choice="1"]');
    await vi.runAllTimersAsync();
    expect(JSON.parse(storage.get(key)!).scenario).toBe("ready");
    expect(doc.getElementById("injected")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it.each(["__proto__", "constructor", "toString"])(
    "handles an invitation key named %s without inherited record access",
    (id) => {
      const { doc, errors } = mount(`#/employees/link?id=${id}`);
      expect(doc.querySelector("h1")).not.toBeNull();
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it("renews and binds an invitation, then preserves the HR handoff and reply in memory", async () => {
    vi.useFakeTimers();
    const { doc, click, location, storage, errors } = mount(
      "#/employees/link?id=e2",
    );
    const submit = (kind: string) => {
      const form = doc.querySelector(`form[data-form="${kind}"]`);
      expect(form).not.toBeNull();
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    };
    click('[data-route="employee/link?id=e2"]');
    click('[data-action="friend"]');
    click('[data-action="expire-invite"]');
    submit("bind");
    expect(doc.getElementById("form-error")?.textContent).toContain(
      "คำเชิญหมดอายุ",
    );
    click('[data-action="invite-renew"]');
    click('[data-action="friend"]');
    submit("bind");
    await vi.runAllTimersAsync();
    expect(location.hash).toBe("#/employee/chat?id=e2");
    click('[data-action="handoff"]');
    click('[data-action="role"][data-role="hr"]');
    click('[data-route="inbox"]');
    click('[data-action="thread-mode"]');
    const reply = doc.querySelector<HTMLInputElement>(
      'form[data-form="hr-reply"] input',
    )!;
    reply.value = "Private HR reply";
    reply.dispatchEvent(new Event("input", { bubbles: true }));
    submit("hr-reply");
    click('[data-action="role"][data-role="employee"]');
    click('[data-route="employee/chat"]');
    expect(doc.getElementById("main")?.textContent).toContain(
      "Private HR reply",
    );
    expect(storage.get(key)).not.toContain("Private HR reply");
    await vi.runAllTimersAsync();
    expect(errors).not.toHaveBeenCalled();
  });
});
