export function resolveTestQuery(
  name: string,
  _args: Record<string, unknown>,
): unknown {
  if (name === "workspace/current:readCurrent")
    return {
      ok: true,
      requestId: "test_workspace",
      value: {
        organization: { id: "prv_org_siam", name: "Siam Industrial" },
        warehouses: [{ id: "prv_wh_bangpoo", code: "BPU", name: "Bang Pu" }],
        navigationPermissions: ["masterData.storageLayout.read"],
        complete: true,
      },
    };
  return undefined;
}
