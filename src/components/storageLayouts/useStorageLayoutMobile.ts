"use client";

import { useMediaQuery } from "@/hooks/useMediaQuery";

const query = "(max-width: 580px)";
export function useStorageLayoutMobile() {
  return useMediaQuery(query);
}
