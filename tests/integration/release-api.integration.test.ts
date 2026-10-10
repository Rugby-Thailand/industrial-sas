import { describe, expect, it, vi } from "vitest";
import {
  createVercelApi,
  deploymentFacts,
} from "../../scripts/release/lib/vercel-api.mjs";

const PROJECT = "prj_test";
const TEAM = "team_test";
const TOKEN = "private-token-marker";
const deployment = (id: string, createdAt: number) => ({
  uid: id,
  url: `${id.replace("_", "-")}.vercel.app`,
  projectId: PROJECT,
  target: "production",
  state: "READY",
  createdAt,
});
const page = (rows: unknown[], next: number | null) => ({
  deployments: rows,
  pagination: { count: rows.length, next, prev: null },
});
function fakeApi(bodies: unknown[], overrides = {}) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const body = bodies.shift();
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return {
    api: createVercelApi({
      token: TOKEN,
      teamId: TEAM,
      fetch: fetchMock,
      ...overrides,
    }),
    fetchMock,
  };
}
function requestedUrl(input: RequestInfo | URL) {
  return new URL(input instanceof Request ? input.url : String(input));
}

describe("bounded complete Vercel release inventory", () => {
  it("exhausts every page and preserves older in-flight deployments", async () => {
    const oldBuild = {
      ...deployment("dpl_older", 100),
      readyState: "BUILDING",
    };
    const { api, fetchMock } = fakeApi([
      page([deployment("dpl_newest", 300)], 200),
      page([deployment("dpl_middle", 200)], 100),
      page([oldBuild], null),
    ]);
    const rows = await api.listProductionDeployments(PROJECT, { limit: 20 });
    expect(rows.map((row: { id: string }) => row.id)).toEqual([
      "dpl_newest",
      "dpl_middle",
      "dpl_older",
    ]);
    expect(rows[2].readyState).toBe("BUILDING");
    const urls = fetchMock.mock.calls.map(([input]) => requestedUrl(input));
    expect(urls.map((url) => url.searchParams.get("until"))).toEqual([
      null,
      "200",
      "100",
    ]);
    for (const url of urls) {
      expect(url.searchParams.get("teamId")).toBe(TEAM);
      expect(url.searchParams.get("projectId")).toBe(PROJECT);
      expect(url.searchParams.get("target")).toBe("production");
    }
  });

  it.each([
    {},
    { deployments: [] },
    { ...page([], null), deployments: null },
    { ...page([], null), pagination: { count: 0 } },
    { ...page([], null), pagination: { count: 1, next: null } },
    page([null], null),
    page([{ ...deployment("dpl_bad", 100), projectId: undefined }], null),
    page([{ ...deployment("dpl_bad", 100), projectId: "prj_other" }], null),
    page([{ ...deployment("dpl_bad", 100), target: "preview" }], null),
    page([{ ...deployment("dpl_bad", 100), state: "UNKNOWN" }], null),
    page([{ ...deployment("dpl_bad", 100), createdAt: "100" }], null),
    page([deployment("invalid", 100)], null),
    page([deployment("dpl_bad", 100)], 0),
    page([deployment("dpl_bad", 100)], -1),
    page([], 100),
  ])("refuses malformed inventory %#", async (body) => {
    const { api } = fakeApi([body]);
    await expect(api.listProductionDeployments(PROJECT)).rejects.toThrow(
      "Vercel API",
    );
  });

  it("refuses a cursor that does not move backwards", async () => {
    const { api } = fakeApi([
      page([deployment("dpl_a", 200)], 100),
      page([deployment("dpl_b", 100)], 100),
    ]);
    await expect(api.listProductionDeployments(PROJECT)).rejects.toThrow(
      "invalid inventory cursor",
    );
  });

  it("refuses truncation when the bounded page cap is reached", async () => {
    const { api, fetchMock } = fakeApi(
      [
        page([deployment("dpl_a", 300)], 200),
        page([deployment("dpl_b", 200)], 100),
      ],
      { maxInventoryPages: 2 },
    );
    await expect(api.listProductionDeployments(PROJECT)).rejects.toThrow(
      "inventory page limit",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses conflicting observations of the same deployment across pages", async () => {
    const first = deployment("dpl_a", 200);
    const { api } = fakeApi([
      page([first], 100),
      page([{ ...first, readyState: "BUILDING" }], null),
    ]);
    await expect(api.listProductionDeployments(PROJECT)).rejects.toThrow(
      "inconsistent inventory deployment",
    );
  });
});

describe("release API transport and alias contracts", () => {
  it("assigns the exact ID and reads alias identity with team/project filters", async () => {
    const { api, fetchMock } = fakeApi([
      { alias: "ci-candidate.thaipropertyai.com" },
      {
        alias: "ci-candidate.thaipropertyai.com",
        projectId: PROJECT,
        deploymentId: "dpl_candidate",
      },
    ]);
    await api.assignAlias("dpl_candidate", "ci-candidate.thaipropertyai.com");
    await api.getAlias("ci-candidate.thaipropertyai.com", PROJECT);
    const [assignInput, assignOptions] = fetchMock.mock.calls[0]!;
    const [readInput] = fetchMock.mock.calls[1]!;
    expect(requestedUrl(assignInput).pathname).toBe(
      "/v2/deployments/dpl_candidate/aliases",
    );
    expect(assignOptions?.method).toBe("POST");
    expect(JSON.parse(String(assignOptions?.body))).toEqual({
      alias: "ci-candidate.thaipropertyai.com",
    });
    expect(assignOptions?.redirect).toBe("error");
    expect(requestedUrl(readInput).pathname).toBe(
      "/v4/aliases/ci-candidate.thaipropertyai.com",
    );
    expect(requestedUrl(readInput).searchParams.get("projectId")).toBe(PROJECT);
    expect(requestedUrl(readInput).searchParams.get("teamId")).toBe(TEAM);
  });

  it("does not read or disclose failed provider bodies", async () => {
    const readBody = vi.fn<() => Promise<string>>(async () => TOKEN);
    const response = new Response(
      JSON.stringify({ error: { code: TOKEN, message: TOKEN } }),
      { status: 403 },
    );
    response.text = readBody;
    const fetchMock = vi.fn<typeof fetch>(async () => response);
    const api = createVercelApi({
      token: TOKEN,
      teamId: TEAM,
      fetch: fetchMock,
    });
    const error: unknown = await api
      .getProject(PROJECT)
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("403");
    expect(String(error)).not.toContain(TOKEN);
    expect(readBody).not.toHaveBeenCalled();
  });

  it("masks both fetch and response-body exceptions", async () => {
    for (const bodyFails of [false, true]) {
      const response = new Response("{}");
      response.text = async () => {
        throw new Error(TOKEN);
      };
      const fetchMock = vi.fn<typeof fetch>(async () => {
        if (!bodyFails) throw new Error(TOKEN);
        return response;
      });
      const api = createVercelApi({
        token: TOKEN,
        teamId: TEAM,
        fetch: fetchMock,
      });
      const error: unknown = await api
        .getProject(PROJECT)
        .catch((caught: unknown) => caught);
      expect(String(error)).toContain("network or response failure");
      expect(String(error)).not.toContain(TOKEN);
    }
  });

  it("bounds a response body that ignores abort", async () => {
    const response = new Response("{}");
    response.text = () => new Promise<string>(() => {});
    const fetchMock = vi.fn<typeof fetch>(async () => response);
    const api = createVercelApi({
      token: TOKEN,
      teamId: TEAM,
      fetch: fetchMock,
      timeoutMs: 10,
    });
    await expect(api.getProject(PROJECT)).rejects.toThrow("timeout");
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it.each(["", "not-json", "null", "[]"])(
    "rejects unreadable successful GET response %j",
    async (body) => {
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(body));
      const api = createVercelApi({
        token: TOKEN,
        teamId: TEAM,
        fetch: fetchMock,
      });
      await expect(api.getProject(PROJECT)).rejects.toThrow("invalid response");
    },
  );

  it("applies the total inventory budget to an individual slow page", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Promise<Response>(() => {}),
    );
    const api = createVercelApi({
      token: TOKEN,
      teamId: TEAM,
      fetch: fetchMock,
      timeoutMs: 1000,
      inventoryTimeoutMs: 10,
    });
    await expect(api.listProductionDeployments(PROJECT)).rejects.toThrow(
      "timeout",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("retains only validated provenance fields from provider metadata", () => {
    expect(
      deploymentFacts({
        ...deployment("dpl_a", 100),
        meta: {
          releaseSha: "a".repeat(40),
          releaseRunId: "123",
          githubCommitSha: TOKEN,
          arbitrarySecret: TOKEN,
        },
      })?.meta,
    ).toEqual({
      releaseSha: "a".repeat(40),
      releaseRunId: "123",
      githubCommitSha: null,
    });
  });
});
