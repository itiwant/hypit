import type { CredentialRef } from "@hypit/runtime";

export const kieProviderModuleRef = { name: "@hypit/provider-kie", version: "1" } as const;

/** Kie's OpenAPI documents `https://api.kie.ai` as the server for every task, upload and Common API cover. */
export const kieProviderDefaults = {
  baseUrl(value?: string): string {
    return assertHttpsBase(value ?? "https://api.kie.ai", "Kie baseUrl");
  },
  uploadBaseUrl(value?: string): string {
    return assertHttpsBase(value ?? "https://api.kie.ai", "Kie uploadBaseUrl");
  },
};

function assertHttpsBase(value: string, subject: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${subject} is empty`);
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`${subject} must use HTTPS or loopback`);
  }
  return trimmed.replace(/\/+$/u, "");
}

export type CreateKieProviderOptions = {
  readonly instance?: string;
  readonly pool?: string;
  readonly baseUrl?: string;
  /** Kie's upload host; defaults to the documented server. One Kie curl example targets
   * `kieai.redpandaai.co` — override here when reality disagrees with the OpenAPI server list. */
  readonly uploadBaseUrl?: string;
  readonly apiKey: CredentialRef;
  readonly defaultConcurrency?: number;
  readonly actionLimits?: import("@hypit/endpoint-kit").EndpointActionLimits;
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
};
