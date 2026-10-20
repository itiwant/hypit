import type {
  AsyncEndpoint, EndpointCredential, EndpointOutcome,
  EndpointRequest, EndpointStartContext, EndpointSupport,
} from "@hypit/hypit/endpoint";
import { credentialRef, defineEndpoint, wakeAfter } from "@hypit/hypit/endpoint";
import { EndpointHttpError, EndpointTransportError, withRequestDeadline } from "@hypit/hypit/endpoint/http";
import { blobTypes } from "@hypit/hypit/blob";
import { canonicalize } from "@hypit/hypit/protocol";
import type { BlobRef,CapabilityRef, CanonicalValue } from "@hypit/hypit/protocol";
import { textTypes } from "@hypit/hypit/text";
import type { CreateKieProviderOptions } from "./options.js";
import { kieProviderDefaults } from "./options.js";
import { KieClient, kieAudioTrackUrls, kieLyricsVariations, kieResultUrls } from "./client.js";
import { KieHttpError, KieServiceError, kieTaskFailure, safeKieReason } from "./errors.js";
import { kieRouteForCapability, kieRoutes, kieCapabilityKey } from "./routes.js";
import { kieMediaURLResolver } from "./upload.js";

export const REMOVE_BACKGROUND_CAPABILITY: CapabilityRef = {
  module: { name: "@hypit/background-removal", version: "1" }, name: "remove-background",
};

/** Suno's lyrics route delivers text (`resultJson.resultObject.lyricsData[]`), not media. */
export const GENERATE_LYRICS_CAPABILITY: CapabilityRef = {
  module: { name: "@hypit/suno", version: "1" }, name: "generate-lyrics",
};

type Handle = {
  readonly contract: "hypit.kie-operation@1";
  readonly taskId: string;
  readonly capability: string;
  readonly model: string;
  readonly startedAt: number;
  readonly urls?: readonly string[];
  /** The packaged lyric body of one generate-lyrics run. */
  readonly text?: string;
};

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function object(value: unknown, subject: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${subject} must be an object`);
  return value as Record<string, unknown>;
}
function apiKey(credentials: Readonly<Record<string, EndpointCredential>>): string {
  const value = credentials.apiKey?.secret;
  assert(typeof value === "string" && value.length > 0, "Kie apiKey credential is unavailable; store a Kie API key for this Endpoint");
  return value;
}
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function failure(error: unknown): EndpointOutcome {
  const code = error instanceof KieServiceError || error instanceof KieHttpError ? error.code : "KIE_ERROR";
  return { status: "failed", failure: { code, message: safeKieReason(failureMessage(error)) } };
}

/** Transport failures and retryable HTTP statuses return to the poll queue; everything else fails. */
function retrying(
  error: unknown, handle: CanonicalValue, pollIntervalMs: number, deadlineAt?: number,
): EndpointOutcome | undefined {
  const delay = error instanceof EndpointTransportError ? pollIntervalMs
    : error instanceof EndpointHttpError && (error.status === 429 || error.status >= 500)
      ? error.retryAfterMs ?? pollIntervalMs : undefined;
  if (delay === undefined) return undefined;
  const now = Date.now();
  return {
    status: "pending", handle,
    wakeAt: Math.min(now + delay, deadlineAt ?? Number.MAX_SAFE_INTEGER),
    progress: { phase: "retrying" },
  };
}

/** Kie's remove-background contract: one image Resource, at most 5 MB in PNG/JPEG/WEBP. */
const REMOVE_BACKGROUND_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"];
const REMOVE_BACKGROUND_MAX_BYTES = 5 * 1_000_000;

function removeBackgroundSupport(request: EndpointRequest): EndpointSupport {
  const source = (request.constraints as { source?: BlobRef } | null)?.source;
  if (source === undefined || typeof source !== "object") {
    return { status: "unsupported", reason: "Background Removal carries no source" };
  }
  if (source.kind !== "blob" || !source.mediaType.startsWith("image/")) {
    return { status: "unsupported", reason: "Background Removal source must be an image Blob" };
  }
  if (!REMOVE_BACKGROUND_MEDIA_TYPES.includes(source.mediaType)) {
    return { status: "unsupported", reason: "Kie's remove-background accepts PNG, JPEG or WEBP images" };
  }
  if (source.size > REMOVE_BACKGROUND_MAX_BYTES) {
    return { status: "unsupported",
      reason: `Kie's remove-background accepts images up to 5 MB; this image is ${(source.size / 1_000_000).toFixed(2)} MB` };
  }
  return { status: "supported" };
}

function generateLyricsSupport(request: EndpointRequest): EndpointSupport {
  const prompt = (request.constraints as { prompt?: unknown } | null)?.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return { status: "unsupported", reason: "generate-lyrics carries no prompt" };
  }
  if (prompt.trim().length > 200) {
    return { status: "unsupported", reason: "Kie's generate-lyrics prompt is capped at 200 characters" };
  }
  return { status: "supported" };
}

function endpointFactory(client: KieClient, pollIntervalMs: number, operationTimeoutMs: number): AsyncEndpoint {
  return {
    async start(context) {
      try {
        const secret = apiKey(context.credentials);
        const isBackground = context.need.capability.module.name === REMOVE_BACKGROUND_CAPABILITY.module.name
          && context.need.capability.name === REMOVE_BACKGROUND_CAPABILITY.name;
        if (isBackground) return await startBackgroundRemoval(client, context, secret, pollIntervalMs);
        const isLyrics = context.need.capability.module.name === GENERATE_LYRICS_CAPABILITY.module.name
          && context.need.capability.name === GENERATE_LYRICS_CAPABILITY.name;
        if (isLyrics) return await startGenerateLyrics(client, context, secret, pollIntervalMs);
        const route = kieRouteForCapability(context.need.capability);
        assert(route !== undefined, "Kie does not implement this exact capability");
        const prepared = route.prepare(context.need.constraints);
        await context.reportProgress?.({ phase: `Preparing Kie request: ${prepared.model}` });
        let body: CanonicalValue;
        try {
          body = await prepared.compile(kieMediaURLResolver(client, context, prepared.mediaLimits, secret));
        } catch (error) {
          throw new KieServiceError("KIE_REQUEST_UNREADY",
            `Kie request preparation failed; model=${prepared.model}; nothing was submitted: ${failureMessage(error)}`);
        }
        await context.reportProgress?.({ phase: `Submitting Kie task: ${prepared.model}` });
        // Kie carries no Idempotency-Key: checkpoint the taskId the moment it exists, before anything else.
        const taskId = await client.createTask(secret, prepared.model, body);
        const handle: Handle = {
          contract: "hypit.kie-operation@1", taskId, capability: kieCapabilityKey(context.need.capability),
          model: prepared.model, startedAt: Date.now(),
        };
        const receipt = { id: taskId };
        await context.checkpoint?.({ handle: canonicalize(handle), receipt });
        return { ...wakeAfter(canonicalize(handle), pollIntervalMs, Date.now(), { phase: "submitted" }), receipt };
      } catch (error) {
        return failure(error);
      }
    },
    async poll(context) {
      try {
        const handle = object(context.handle, "Kie handle") as unknown as Handle;
        assert(handle.contract === "hypit.kie-operation@1" && typeof handle.taskId === "string"
          && handle.taskId.length > 0, "Kie handle is invalid");
        const receipt = { id: handle.taskId };
        if (Date.now() - handle.startedAt > operationTimeoutMs) {
          return { status: "failed", receipt, failure: {
            code: "KIE_OPERATION_TIMEOUT",
            message: `Kie task ${handle.taskId} exceeded this Provider's operationTimeoutMs (${operationTimeoutMs}); the remote outcome is unknown`,
          } };
        }
        const record = await client.recordInfo(apiKey(context.credentials), handle.taskId);
        const state = typeof record.state === "string" ? record.state : undefined;
        if (state === "waiting" || state === "queuing" || state === "generating") {
          return { ...wakeAfter(canonicalize(handle), pollIntervalMs, Date.now(), { phase: state }), receipt };
        }
        const rejected = kieTaskFailure(record);
        if (rejected !== undefined) {
          return { status: "failed", receipt, failure: {
            code: rejected.failCode,
            message: `Kie task ${handle.taskId} failed; ${rejected.failCode}: ${rejected.reason}`,
          } };
        }
        assert(state === "success", `Kie returned the unknown task state ${String(state)}`);
        if (handle.capability === kieCapabilityKey(GENERATE_LYRICS_CAPABILITY)) {
          const variations = kieLyricsVariations(record);
          return {
            status: "ready",
            handle: canonicalize({ ...handle, text: variations.map((item) => item.text).join("\n\n") }),
            receipt,
          };
        }
        // Suno audio routes answer with per-track `data.response.data[]`; TTS and the
        // media routes answer with `resultUrls`.
        const urls = kieAudioTrackUrls(record) ?? kieResultUrls(record);
        return { status: "ready", handle: canonicalize({ ...handle, urls }), receipt };
      } catch (error) {
        const parsed = (context.handle ?? {}) as Partial<Handle>;
        const deadlineAt = typeof parsed.startedAt === "number"
          ? parsed.startedAt + operationTimeoutMs : undefined;
        return retrying(error, context.handle, pollIntervalMs, deadlineAt) ?? failure(error);
      }
    },
    async collect(context) {
      try {
        const handle = object(context.handle, "Kie handle") as unknown as Handle;
        if (handle.capability === kieCapabilityKey(GENERATE_LYRICS_CAPABILITY)) {
          assert(typeof handle.text === "string" && handle.text.trim().length > 0,
            "Kie carry handle has no collected lyrics text");
          await context.reportProgress?.({ phase: "Receiving generated lyrics" });
          return {
            status: "completed",
            result: { value: { kind: "inline" as const, value: canonicalize({ value: handle.text }) } },
            receipt: { id: handle.taskId },
          };
        }
        assert(Array.isArray(handle.urls) && handle.urls.length > 0, "Kie carry handle has no collected URLs");
        const isBackground = handle.capability === kieCapabilityKey(REMOVE_BACKGROUND_CAPABILITY);
        await context.reportProgress?.({ phase: "Receiving generated files" });
        const blobs: BlobRef[] = [];
        for (const url of handle.urls) {
          const downloaded = await download(client, apiKey(context.credentials), url);
          blobs.push(await context.resources.put(downloaded.bytes, downloaded.mediaType));
        }
        if (isBackground) {
          assert(blobs.length === 1, "Kie returned more than one image for background removal");
          return { status: "completed", result: { value: blobs[0]! }, receipt: { id: handle.taskId } };
        }
        const route = routeOf(handle.capability);
        return { status: "completed", result: { value: route.packageResult(blobs) }, receipt: { id: handle.taskId } };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

function routeOf(capabilityKey: string) {
  const route = kieRoutes.find((candidate) => candidate.key === capabilityKey);
  assert(route !== undefined, `Kie has no route for ${capabilityKey}`);
  return route;
}

async function startBackgroundRemoval(
  client: KieClient, context: EndpointStartContext, secret: string, pollIntervalMs: number,
): Promise<EndpointOutcome> {
  const constraints = object(context.need.constraints, "Background Removal request");
  const source = constraints.source;
  assert(source !== null && typeof source === "object", "Background Removal request carries no source");
  const artifact = source as unknown as BlobRef;
  assert(artifact.kind === "blob" && typeof artifact.mediaType === "string" && typeof artifact.resource === "string",
    "Background Removal source must be a BlobRef");
  assert(REMOVE_BACKGROUND_MEDIA_TYPES.includes(artifact.mediaType),
    "Kie's remove-background accepts PNG, JPEG or WEBP images");
  assert(artifact.size <= REMOVE_BACKGROUND_MAX_BYTES,
    `Kie's remove-background accepts images up to 5 MB; this image is ${(artifact.size / 1_000_000).toFixed(2)} MB`);
  const bytes = await context.resources.get(artifact.resource);
  assert(bytes !== undefined && bytes.byteLength === artifact.size,
    `Reference Resource ${artifact.resource} is unavailable or has changed`);
  await context.reportProgress?.({ phase: "Uploading the image for background removal" });
  const imageUrl = await client.uploadMedia(secret, bytes, artifact.mediaType);
  await context.reportProgress?.({ phase: "Submitting Kie task: recraft/remove-background" });
  const taskId = await client.createTask(secret, "recraft/remove-background", { image: imageUrl });
  const handle: Handle = {
    contract: "hypit.kie-operation@1", taskId, capability: kieCapabilityKey(REMOVE_BACKGROUND_CAPABILITY),
    model: "recraft/remove-background", startedAt: Date.now(),
  };
  const receipt = { id: taskId };
  await context.checkpoint?.({ handle: canonicalize(handle), receipt });
  return { ...wakeAfter(canonicalize(handle), pollIntervalMs, Date.now(), { phase: "submitted" }), receipt };
}

/** `ai-music-api/generate-lyrics` — one `prompt` in, lyric variations out (docs cap the prompt at 200 chars). */
async function startGenerateLyrics(
  client: KieClient, context: EndpointStartContext, secret: string, pollIntervalMs: number,
): Promise<EndpointOutcome> {
  const constraints = object(context.need.constraints, "generate-lyrics request");
  const prompt = constraints.prompt;
  assert(typeof prompt === "string" && prompt.trim().length > 0, "generate-lyrics request carries no prompt");
  assert(prompt.trim().length <= 200, "Kie's generate-lyrics prompt is capped at 200 characters");
  await context.reportProgress?.({ phase: "Submitting Kie task: ai-music-api/generate-lyrics" });
  const taskId = await client.createTask(secret, "ai-music-api/generate-lyrics", { prompt: prompt.trim() });
  const handle: Handle = {
    contract: "hypit.kie-operation@1", taskId, capability: kieCapabilityKey(GENERATE_LYRICS_CAPABILITY),
    model: "ai-music-api/generate-lyrics", startedAt: Date.now(),
  };
  const receipt = { id: taskId };
  await context.checkpoint?.({ handle: canonicalize(handle), receipt });
  return { ...wakeAfter(canonicalize(handle), pollIntervalMs, Date.now(), { phase: "submitted" }), receipt };
}

async function download(client: KieClient, key: string, url: string): Promise<{ readonly bytes: Uint8Array; readonly mediaType: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new KieServiceError("KIE_UNSAFE_ASSET_URL", "Kie assets must be served over HTTPS or loopback");
  }
  return await withRequestDeadline(client.timeoutMs, async ({ signal, wait }) => {
    const response = await wait(client.fetcher(parsed.href, { signal }));
    if (!response.ok) throw new KieHttpError("KIE_HTTP_ASSET", `Kie asset returned HTTP ${response.status}`, response.status);
    return {
      bytes: new Uint8Array(await wait(response.arrayBuffer())),
      mediaType: response.headers.get("content-type")?.split(";", 1)[0] ?? "application/octet-stream",
    };
  }, () => new EndpointTransportError("Kie asset download timed out", { timeout: true }));
}

export function createKieProvider(options: CreateKieProviderOptions) {
  const baseUrl = kieProviderDefaults.baseUrl(options.baseUrl);
  const uploadBaseUrl = kieProviderDefaults.uploadBaseUrl(options.uploadBaseUrl);
  const requestTimeoutMs = options.requestTimeoutMs ?? 300_000;
  const operationTimeoutMs = options.operationTimeoutMs ?? 15 * 60_000;
  const client = new KieClient(baseUrl, uploadBaseUrl, requestTimeoutMs, options.fetch ?? globalThis.fetch);
  const asyncEndpoint: AsyncEndpoint = endpointFactory(client, options.pollIntervalMs ?? 5_000, operationTimeoutMs);
  return defineEndpoint({
    instance: options.instance ?? "kie.default",
    pool: options.pool ?? options.instance ?? "kie.default",
    pricing: { kind: "page", url: "https://kie.ai/pricing" },
    async readPricing(context) {
      const status = await client.credits(apiKey(await context.credentials()));
      return [{
        source: `${baseUrl}/api/v1/chat/credit`,
        data: { remainingCredits: status },
        summary: `Kie reports ${status} credit(s) remaining`,
      }];
    },
    credentials: { apiKey: options.apiKey ?? credentialRef("local", "kie.api-key") },
    credentialInputs: { apiKey: { label: "Kie API key" } },
    defaultConcurrency: options.defaultConcurrency ?? 4,
    ...(options.actionLimits === undefined ? {} : { actionLimits: options.actionLimits }),
    capabilities: [
      ...kieRoutes.map((route) => ({
        capability: route.capability, returns: route.returns, lifecycle: "asynchronous" as const,
        endpoint: asyncEndpoint, capacity: route.capability.name, supports: route.supports,
      })),
      {
        capability: REMOVE_BACKGROUND_CAPABILITY, returns: blobTypes.blob, lifecycle: "asynchronous" as const,
        endpoint: asyncEndpoint, capacity: "remove-background", supports: removeBackgroundSupport,
      },
      {
        capability: GENERATE_LYRICS_CAPABILITY, returns: textTypes.text, lifecycle: "asynchronous" as const,
        endpoint: asyncEndpoint, capacity: "generate-lyrics", supports: generateLyricsSupport,
      },
    ],
  });
}
