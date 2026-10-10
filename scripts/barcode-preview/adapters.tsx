import { createElement, type ComponentProps, type ReactNode } from "react";
import { getFunctionName } from "convex/server";

export function QueryGate({
  children,
}: {
  children: (id: string) => ReactNode;
}) {
  return children("demo-warehouse");
}
export function useDraftKey() {
  return "preview-actor";
}
export function useCanManage() {
  return true;
}
export function useUploadThing() {
  return {
    startUpload: async () => {
      throw new Error("Uploads disabled in preview");
    },
  };
}
export function useRouter() {
  return { push: () => {}, back: () => {} };
}
export function Link(props: ComponentProps<"a">) {
  return <a {...props} />;
}
export default function Image({
  unoptimized: _,
  ...props
}: ComponentProps<"img"> & { unoptimized?: boolean }) {
  return createElement("img", props);
}
export const previewCalls: { kind: string; args: unknown }[] = [];
export function useAction() {
  return async () => {
    throw new Error("AI disabled in barcode preview");
  };
}
export function useMutation() {
  return async (args: unknown) => {
    previewCalls.push({ kind: "save", args });
    return {
      ok: true,
      requestId: "preview-write",
      value: { written: true, documentId: "demo-scan", replayed: false },
    };
  };
}
export function useQuery(
  reference: Parameters<typeof getFunctionName>[0],
  args: { text?: string; code?: string } | "skip",
) {
  if (args === "skip") return undefined;
  if (getFunctionName(reference).includes("resolveJobScanLocation"))
    return {
      ok: true,
      value: { ok: false, error: { code: "LOCATION_NOT_FOUND" } },
    };
  const items = [
    { zoneId: "demo-zone", code: "F2-L28-18", name: "Demo slot" },
  ].filter(
    (row) =>
      !args.text || row.code.toLowerCase().includes(args.text.toLowerCase()),
  );
  return {
    ok: true,
    value: {
      items,
      status: "ready",
      isDone: true,
      continueCursor: "",
      page: 1,
      pages: 1,
      total: items.length,
    },
  };
}
export function useConvex() {
  return {
    query: async (
      reference: Parameters<typeof getFunctionName>[0],
      args: { code: string; warehouseId: string },
    ) => {
      previewCalls.push({ kind: getFunctionName(reference), args });
      return {
        ok: true,
        value:
          args.code === "F2-L28-18"
            ? {
                ok: true,
                location: {
                  zoneId: "demo-zone",
                  code: args.code,
                  name: "Demo slot",
                },
              }
            : { ok: false, error: { code: "LOCATION_UNAVAILABLE" } },
      };
    },
  };
}
