import {
  createRuntimeEndpointAdapterFacet, runtimeConfigActionLimits, runtimeConfigCredentialRef,
  runtimeConfigExact, runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/runtime-kit";

import { createKieProvider } from "./provider.js";

const adapter = createRuntimeEndpointAdapterFacet({
  use: "@hypit/provider-kie",
  activate(context) {
    if (context.pool === undefined) throw new Error("Kie Provider Pool is required");
    const config = runtimeConfigObject(context.config, "Kie");
    runtimeConfigExact(config, [
      "baseUrl",
      "uploadBaseUrl",
      "apiKey",
      "defaultConcurrency",
      "actionLimits",
      "pollIntervalMs",
      "requestTimeoutMs",
      "operationTimeoutMs",
    ], "Kie");
    const baseUrl = runtimeConfigString(config.baseUrl, "Kie baseUrl");
    const uploadBaseUrl = runtimeConfigString(config.uploadBaseUrl, "Kie uploadBaseUrl");
    const apiKey = runtimeConfigCredentialRef(config.apiKey, "Kie apiKey");
    if (apiKey === undefined) throw new Error("Kie apiKey CredentialRef is required");
    const actionLimits = runtimeConfigActionLimits(config.actionLimits);
    const defaultConcurrency = runtimeConfigPositiveInteger(config.defaultConcurrency, "Kie defaultConcurrency");
    const pollIntervalMs = runtimeConfigPositiveInteger(config.pollIntervalMs, "Kie pollIntervalMs");
    const requestTimeoutMs = runtimeConfigPositiveInteger(config.requestTimeoutMs, "Kie requestTimeoutMs");
    const operationTimeoutMs = runtimeConfigPositiveInteger(config.operationTimeoutMs, "Kie operationTimeoutMs");
    return {
      endpoint: createKieProvider({
        instance: context.instance,
        pool: context.pool,
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(uploadBaseUrl === undefined ? {} : { uploadBaseUrl }),
        apiKey,
        ...(defaultConcurrency === undefined ? {} : { defaultConcurrency }),
        ...(actionLimits === undefined ? {} : { actionLimits }),
        ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
        ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
        ...(operationTimeoutMs === undefined ? {} : { operationTimeoutMs }),
      }),
    };
  },
});

export const hypitPackage = {
  format: "hypit.node-package@1" as const,
  hostFacets: [adapter],
};

export default hypitPackage;
