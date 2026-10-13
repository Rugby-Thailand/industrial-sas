// Local lab contracts; never export a URL, query, identifier or exception message.
export function measurementOptions(env = process.env) {
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw Error(`Invalid ${name}`);
    return value;
  };
  const list = (name, fallback, allowed) => {
    const values = (env[name] ?? fallback).split(",");
    if (!values.length || values.some((value) => !allowed.includes(value)))
      throw Error(`Invalid ${name}`);
    return [...new Set(values)];
  };
  const network = list("PERFORMANCE_NETWORK", "none", ["none", "latency150"]);
  if (network.length !== 1) throw Error("Select one PERFORMANCE_NETWORK");
  return {
    samples: integer("PERFORMANCE_SAMPLES", 20, 20, 200),
    warmups: integer("PERFORMANCE_WARMUPS", 2, 1, 10),
    widths: list("PERFORMANCE_WIDTHS", "1440,390", ["1440", "390"]).map(Number),
    locales: list("PERFORMANCE_LOCALES", "en", ["en", "th"]),
    scenarios: list("PERFORMANCE_SCENARIOS", "floor,scan", [
      "floor",
      "scan",
      "hr",
      "legacy",
    ]),
    network: network[0],
  };
}

export function evidenceLabel(label) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(label))
    throw Error("Invalid evidence label");
  return label;
}

export function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([
      row.flow,
      row.width ?? row.viewport,
      row.locale,
      row.cache,
    ]);
    const group = groups.get(key) ?? {
      flow: row.flow,
      width: row.width ?? row.viewport,
      locale: row.locale,
      cache: row.cache,
      completed: 0,
      cancellations: 0,
      errors: 0,
      timings: {},
    };
    groups.set(key, group);
    if (row.status === "cancelled") {
      group.cancellations++;
      continue;
    }
    if (row.status === "error") {
      group.errors++;
      continue;
    }
    group.completed++;
    for (const name of [
      "urlObservedMs",
      "dataReadyMs",
      "usableMs",
      "decodeMs",
    ]) {
      if (Number.isFinite(row[name]))
        (group.timings[name] ??= []).push(row[name]);
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    timings: Object.fromEntries(
      Object.entries(group.timings).map(([name, values]) => {
        const sorted = values.sort((a, b) => a - b);
        return [
          name,
          {
            n: sorted.length,
            p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
            p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
          },
        ];
      }),
    ),
  }));
}

// Executed in the browser by page.evaluate. Reads the installed router's URL;
// does not patch history, generate events or infer a React route-shell commit.
export function observeTransition({
  target,
  ready,
  action,
  timeoutMs = 15000,
}) {
  return new Promise((resolve) => {
    const start = performance.now();
    const original = location.pathname + location.search;
    let urlObservedMs;
    let frame;
    let finished = false;
    let actionStarted = false;
    const finish = (status, reason) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      removeEventListener("pagehide", onUnmount);
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onError);
      removeEventListener("click", onSupersedingClick, true);
      resolve({
        status,
        ...(reason ? { reason } : {}),
        ...(urlObservedMs === undefined ? {} : { urlObservedMs }),
        ...(status === "completed"
          ? { dataReadyMs: performance.now() - start }
          : { elapsedMs: performance.now() - start }),
      });
    };
    const onUnmount = () => finish("cancelled", "unmount");
    const onError = () => finish("error", "page-error");
    const onSupersedingClick = (event) => {
      if (!actionStarted) return;
      const anchor = event.target?.closest?.("a[href]");
      if (anchor && anchor.getAttribute("href") !== target)
        finish("cancelled", "superseded");
    };
    const visible = (node) =>
      Boolean(
        node &&
        node.getClientRects().length &&
        !node.closest('[hidden], [aria-hidden="true"], [aria-busy="true"]'),
      );
    const dataReady = () => {
      const main = document.querySelector("main");
      if (!main) return false;
      const find = (selector) =>
        [...main.querySelectorAll(selector)].find(visible);
      if (ready.kind === "floor")
        return Boolean(
          find(`button[aria-label="${ready.toolbar}"]`) &&
          find("[data-map-zone-id]"),
        );
      if (ready.kind === "catalogue")
        return Boolean(find(`a[href="${ready.floor}"]`));
      if (ready.kind === "goods")
        return Boolean(find('a[href*="/finished-goods/products/"]'));
      if (ready.kind === "scan")
        return (
          find("h1")?.textContent === ready.heading &&
          [...main.querySelectorAll("button")].some(
            (node) =>
              visible(node) && node.textContent?.includes("DEMO-ANNEX-"),
          )
        );
      if (ready.kind === "hr-editor")
        return Boolean(
          find('[data-testid="hr-employee-form"] input[id$="-name"]'),
        );
      if (ready.kind === "hr-list")
        return (
          !find('[data-testid="hr-employee-form"]') &&
          Boolean(find(`button[aria-label^="${ready.editPrefix}"]`))
        );
      return false;
    };
    const tick = () => {
      if (finished) return;
      const current = location.pathname + location.search;
      const matches =
        target === "hr-editor"
          ? location.pathname === original.split("?")[0] &&
            new URLSearchParams(location.search).get("mode") === "edit" &&
            new URLSearchParams(location.search).has("employee")
          : current === target;
      if (matches && urlObservedMs === undefined)
        urlObservedMs = performance.now() - start;
      if (
        (!matches && current !== original) ||
        (urlObservedMs !== undefined && !matches)
      )
        return finish("cancelled", "superseded");
      if (matches && dataReady()) return finish("completed");
      if (performance.now() - start > timeoutMs)
        return finish("error", "timeout");
      frame = requestAnimationFrame(tick);
    };
    addEventListener("pagehide", onUnmount);
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onError);
    addEventListener("click", onSupersedingClick, true);
    const element =
      action.kind === "link"
        ? [...document.querySelectorAll("a")].find(
            (node) => node.getAttribute("href") === action.href,
          )
        : [...document.querySelectorAll("button")].find(
            (node) =>
              visible(node) &&
              (action.kind === "hr-edit"
                ? node.getAttribute("aria-label")?.startsWith(action.name)
                : (node.getAttribute("aria-label") ??
                    node.textContent?.trim()) === action.name),
          );
    if (!element || element.disabled) return finish("error", "missing-control");
    try {
      element.click();
      actionStarted = true;
      frame = requestAnimationFrame(tick);
    } catch {
      finish("error", "action-error");
    }
  });
}
