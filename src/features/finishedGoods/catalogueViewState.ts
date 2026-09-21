import { preferences } from "@/lib/browser/storage";
export type CatalogueViewState = {
  tab: "products" | "pallets";
  search: string;
  status: string;
  layout: "cards" | "table";
};

export const defaultCatalogueView: CatalogueViewState = {
  tab: "products",
  search: "",
  status: "ALL",
  layout: "cards",
};

const productStatuses = ["ALL", "DRAFT", "ACTIVE"];
const unitStatuses = [
  "ALL",
  "AWAITING_MEASUREMENT",
  "AWAITING_PLACEMENT",
  "RESERVED",
  "STORED",
  "MOVE_RESERVED",
  "IN_TRANSIT",
];

export function readCatalogueView(key: string): CatalogueViewState {
  return preferences.read(
    key,
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return { ...defaultCatalogueView };
      const saved = value as Record<string, unknown>;
      const tab = saved.tab === "pallets" ? "pallets" : "products";
      const statuses = tab === "products" ? productStatuses : unitStatuses;
      return {
        tab,
        search: typeof saved.search === "string" ? saved.search : "",
        status:
          typeof saved.status === "string" && statuses.includes(saved.status)
            ? saved.status
            : "ALL",
        layout: saved.layout === "table" ? "table" : "cards",
      };
    },
    { ...defaultCatalogueView },
  );
}

export function saveCatalogueView(key: string, value: CatalogueViewState) {
  preferences.write(key, value);
}
