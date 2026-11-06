"use client";

import { createContext, useContext } from "react";

/**
 * Whether the shell's backend link has stalled, on the timing of its
 * connection notice: `"first"` while the first connection has not opened,
 * `"dropped"` while an open one stays down, otherwise `null`. Loading
 * presenters then wait without motion instead of promising data. Outside the
 * shell it is always `null`, so they load as usual.
 */
export type ConnectionStall = "first" | "dropped" | null;

export const ConnectionStallContext = createContext<ConnectionStall>(null);
export const useConnectionStall = () => useContext(ConnectionStallContext);
