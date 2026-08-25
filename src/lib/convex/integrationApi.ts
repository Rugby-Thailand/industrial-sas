import { api } from "../../../convex/_generated/api";

import { clientRef, type RefValue } from "./clientRef";

export const listIntegrationHealthRef = clientRef(
  api.integrations.delivery.listIntegrationHealth,
);

export const registerIntegrationAdapterRef = clientRef(
  api.integrations.delivery.registerAdapter,
);

export const setIntegrationAdapterStatusRef = clientRef(
  api.integrations.delivery.setAdapterStatus,
);

export const retryIntegrationMessageRef = clientRef(
  api.integrations.delivery.retryMessage,
);

export type IntegrationHealthPayload = RefValue<
  typeof listIntegrationHealthRef
>;
export type IntegrationHealthRow = IntegrationHealthPayload["adapters"][number];
export type IntegrationAdapterKind = IntegrationHealthRow["kind"];
export type IntegrationAdapterStatus = IntegrationHealthRow["status"];
