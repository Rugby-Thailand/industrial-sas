"use client";

import { createContext, useContext } from "react";

// Reading shell feedback must not pull the Next router into standalone controls.
export const NavigationActionPendingContext = createContext(false);
export const useNavigationPending = () =>
  useContext(NavigationActionPendingContext);
