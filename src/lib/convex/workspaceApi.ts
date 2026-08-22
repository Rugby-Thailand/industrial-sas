import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

export const readCurrentWorkspaceRef = clientRef(
  api.workspace.current.readCurrent,
);
