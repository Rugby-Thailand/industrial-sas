"use client";
import { useCan } from "./useCan";
/** Compatibility hook for the existing warehouse management permission. */
export function useCanManage() {
  return useCan("masterData.storageLayout.manage");
}
