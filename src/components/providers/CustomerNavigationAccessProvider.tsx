"use client";

import { useConvexAuth, useQuery_experimental } from "convex/react";
import { createContext, useContext, type ReactNode } from "react";

import { api } from "../../../convex/_generated/api";
import { NAVIGATION_PERMISSION } from "../../../convex/model/authorization/navigationPermissions";
import { clientRef } from "@/lib/convex/clientRef";

import { useWorkspace } from "./WorkspaceProvider";

const viewerRef = clientRef(api.customers.catalogue.viewer);
const READ = [NAVIGATION_PERMISSION.customers] as const;
const MANAGE = [...READ, NAVIGATION_PERMISSION.customerManage] as const;
const EMPTY: readonly string[] = [];

interface CustomerNavigationAccess {
  readonly permissions: readonly string[];
  readonly loading: boolean;
}

const CustomerNavigationAccessContext = createContext<CustomerNavigationAccess>(
  {
    permissions: EMPTY,
    loading: false,
  },
);

/** Customer destinations can be opened with organization grants alone. */
export function CustomerNavigationAccessProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { permissionsReady } = useWorkspace();
  const canQuery = !permissionsReady && !isLoading && isAuthenticated;
  const query = useQuery_experimental({
    query: viewerRef,
    args: canQuery ? {} : "skip",
  });
  const viewer =
    canQuery && query.status === "success" && query.data.ok
      ? query.data.value
      : null;
  const value = {
    permissions: viewer === null ? EMPTY : viewer.canManage ? MANAGE : READ,
    loading: canQuery && query.status === "pending",
  };
  return (
    <CustomerNavigationAccessContext.Provider value={value}>
      {children}
    </CustomerNavigationAccessContext.Provider>
  );
}

export function useCustomerNavigationAccess(): CustomerNavigationAccess {
  return useContext(CustomerNavigationAccessContext);
}
