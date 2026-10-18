// Paste into the browser console of a signed-in LOCAL application.
// Real Clerk + Convex authorization/quota preflight; no OpenRouter requests.
// Tokens stay inside this function and are never printed or persisted.
(async () => {
  const browser = globalThis;
  if (
    !browser.location ||
    !["localhost", "127.0.0.1", "[::1]"].includes(browser.location.hostname) ||
    !browser.Clerk?.session ||
    !browser.Clerk.organization
  )
    throw new Error(
      "Run this in a signed-in local app with an active organization.",
    );

  const session = browser.Clerk.session;
  const organizationId = browser.Clerk.organization.id;
  const body = JSON.stringify({
    query: " ",
    context: { page: null, employee: false, date: false, period: false },
  });
  const rows = [];
  for (let index = 0; index < 6; index += 1) {
    for (const path of ["server-token", "browser-token"]) {
      if (
        browser.Clerk.session?.id !== session.id ||
        browser.Clerk.organization?.id !== organizationId
      )
        throw new Error("The active session or organization changed.");
      const start = performance.now();
      const [sessionToken, convexToken] = await Promise.all([
        session.getToken({ organizationId }),
        path === "browser-token"
          ? session.getToken({ template: "convex", organizationId })
          : Promise.resolve(null),
      ]);
      if (!sessionToken || (path === "browser-token" && !convexToken))
        throw new Error("Authentication token unavailable.");
      const acquired = performance.now();
      const headers = {
        "content-type": "application/json",
        authorization: `Bearer ${sessionToken}`,
      };
      if (convexToken) headers["x-convex-token"] = convexToken;
      const response = await fetch("/api/ai/search", {
        method: "POST",
        headers,
        credentials: "same-origin",
        cache: "no-store",
        body,
      });
      const answer = await response.json();
      if (response.status !== 200 || answer.value?.code !== "QUERY_INVALID")
        throw new Error(
          "Benchmark request did not return the expected result.",
        );
      const timings = response.headers.get("server-timing") ?? "";
      const duration = (name) => {
        const value = timings.match(
          new RegExp(`(?:^|,\\s*)${name};dur=([\\d.]+)`),
        );
        if (!value) throw new Error("Server-Timing duration missing.");
        return Number(value[1]);
      };
      rows.push({
        path,
        warmup: index === 0,
        tokenAcquisitionMs: Number((acquired - start).toFixed(2)),
        totalMs: Number((performance.now() - start).toFixed(2)),
        authMs: duration("auth"),
        convexMs: duration("convex"),
      });
    }
  }
  const summary = ["server-token", "browser-token"].map((path) => {
    const samples = rows.filter((row) => row.path === path && !row.warmup);
    const median = (key) => {
      const sorted = samples.map((row) => row[key]).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    return {
      path,
      samples: samples.length,
      tokenAcquisitionMedianMs: median("tokenAcquisitionMs"),
      totalMedianMs: median("totalMs"),
      authMedianMs: median("authMs"),
      convexMedianMs: median("convexMs"),
    };
  });
  const result = {
    scope:
      "Local HTTP comparison of server token generation and browser token reuse. Real Clerk and Convex; whitespace query avoids OpenRouter. One warmup per path excluded. Not a production or framework comparison.",
    summary,
    rows,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
})();
