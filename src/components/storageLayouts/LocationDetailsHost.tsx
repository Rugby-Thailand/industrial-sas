"use client";

import { createContext } from "react";

/** Move read-only details between inspector and sheet without remounting editors. */
export const LocationDetailsHost = createContext<{
  target: HTMLElement | null;
  editZone: ((id: string) => void) | undefined;
  runAction: (action: () => void) => void;
  selectedUnitId: string | undefined;
} | null>(null);
