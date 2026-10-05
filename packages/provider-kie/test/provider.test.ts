import assert from "node:assert/strict";
import test from "node:test";
import { verifyGeneratedVideoSet } from "@hypit/generation";
import type {
  AsyncEndpoint, EndpointRegistrar, EndpointStartContext,
} from "@hypit/endpoint-kit";
import type { BlobRef, CanonicalValue } from "@hypit/protocol";
import { canonicalize } from "@hypit/protocol";
import type { ResourceStore } from "@hypit/runtime";
import { sealSeedanceRequest } from "@hypit/seedance";

import { createKieProvider } from "../src/provider.js";

const SERVICE_KEY = "kie-key-1";
const UPLOAD_URL = "https://upload.kie.ai/u1.png";
const RESULT_URL = "https://cdn.kie.ai/r0.mp4";
const DOWNLOAD_BYTES = new Uint8Array([1, 2, 3, 4]);

const capability = { module: { name: "@hypit/seedance", version: "1" }, name: "seedance-2-mini" } as const;

type RecordedCall = { url: string; method: string; body: unknown; authorization?: string | undefined };

type PollPhase = "waiting" | "generating" | "fail" | "disappeared" | "success";

/** One fake Kie server for the four endpoints this suite drives. */
function makeServer(pollPhases: readonly PollPhase[]) {
  const calls: RecordedCall[] = [];
  const bodies: readonly unknown[] = [];
  void bodies;
  let submitted: { readonly model: string; readonly input: Record<string, unknown> } | undefined;
  let polls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const parsedBody: unknown = rawBody === undefined ? undefined : JSON.parse(rawBody);
    calls.push({ url, method, body: parsedBody, authorization: headers.get("authorization") ?? undefined });
    const respond = (payload: unknown): Response =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/file-base64-upload")) {
      return respond({ code: 200, msg: "", data: { downloadUrl: UPLOAD_URL } });
    }
    if (url.endsWith("/api/v1/jobs/createTask")) {
      submitted = parsedBody as { model: string; input: Record<string, unknown> };
      return respond({ code: 200, msg: "", data: { taskId: "task_kie_1" } });
    }
    if (url.includes("/api/v1/jobs/recordInfo")) {
      const phase = pollPhases[Math.min(polls, pollPhases.length - 1)]!;
      polls += 1;
      if (phase === "fail") {
        return respond({ code: 200, msg: "", data: { taskId: "task_kie_1", state: "fail",
          failCode: "Generate Media Error", failMsg: "prompt contained blocked words" } });
      }
      if (phase === "success") {
        return respond({ code: 200, msg: "", data: { taskId: "task_kie_1", state: "success",
          response: { resultUrls: [RESULT_URL] } } });
      }
      return respond({ code: 200, msg: "", data: { taskId: "task_kie_1", state: phase } });
    }
    if (url.startsWith("https://cdn.kie.ai/")) {
      return new Response(new Uint8Array(DOWNLOAD_BYTES), {
        status: 200, headers: { "content-type": "video/mp4" },
      });
    }
    if (url.endsWith("/api/v1/chat/credit")) {
      return respond({ code: 200, msg: "", data: 2145 });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return {
    calls, fetcher,
    submitted: () => submitted,
    pollCount: () => polls,
  };
}

function makeStore(bytes: Uint8Array) {
  const stored: { readonly bytes: Uint8Array; readonly mediaType: string }[] = [];
  const store: ResourceStore = {
    async put(writeBytes, mediaType) {
      stored.push({ bytes: new Uint8Array(writeBytes), mediaType });
      const blob: BlobRef = {
        kind: "blob", resource: `res_kie_out_${stored.length}`, size: writeBytes.byteLength, mediaType,
      };
      return blob;
    },
    async write() {},
    async get(resource) {
      return resource === "res_kie_input" ? bytes : undefined;
    },
    async has(resource) { return resource === "res_kie_input"; },
  };
  return { store, stored, bytes };
}

function makeContext(server: ReturnType<typeof makeServer>, store: ResourceStore, constraints: CanonicalValue) {
  void server;
  const checkpoints: Record<string, unknown>[] = [];
  const context: Partial<EndpointStartContext> & Pick<EndpointStartContext, "operation"> = {
    operation: "op_kie_1",
    need: {
      id: "need_kie_1", capability, returns: { module: { name: "@hypit/generation", version: "1" }, name: "GeneratedVideoSet" },
      constraints, result: "result_kie_1",
    },
    resources: store,
    credentials: { apiKey: { secret: SERVICE_KEY } },
    reportProgress: async () => {},
    checkpoint: async (checkpoint) => { checkpoints.push(canonicalize(checkpoint) as unknown as Record<string, unknown>); },
  };
  return {
    context: context as unknown as EndpointStartContext,
    checkpoints,
  };
}

/** install() hands each capability's endpoint back through the registrar; capture it for direct driving. */
async function makeProvider(server: ReturnType<typeof makeServer>) {
  const endpoints = new Map<string, AsyncEndpoint>();
  const registrar: EndpointRegistrar = {
    registerImmediateEndpoint() { throw new Error("Kie registers no immediate endpoints"); },
    registerAsyncEndpoint(_id, capabilityRef, _returns, endpoint) {
      endpoints.set(`${capabilityRef.module.name}>${capabilityRef.name}`, endpoint);
    },
  };
  const provider = createKieProvider({
    apiKey: { store: "os", key: "kie.test-key" },
    pollIntervalMs: 10, requestTimeoutMs: 5_000, operationTimeoutMs: 60_000,
    fetch: server.fetcher,
  });
  await provider.install(registrar);
  return { provider, endpointOf: (module: string, name: string) => endpoints.get(`${module}>${name}`) };
}

test("the verified registry captures one endpoint per generation capability", async () => {
  const server = makeServer(["waiting"]);
  const { endpointOf } = await makeProvider(server);
  assert(endpointOf("@hypit/seedance", "seedance-2.5") !== undefined);
  assert(endpointOf("@hypit/gpt-image", "gpt-image-2") !== undefined);
  assert(endpointOf("@hypit/background-removal", "remove-background") !== undefined);
});

test("seedance run goes live and collects one sealed video set", async () => {
  const server = makeServer(["waiting", "success"]);
  const store = makeStore(new Uint8Array([9, 8, 7]));
  const { endpointOf } = await makeProvider(server);
  const endpoint = endpointOf("@hypit/seedance", "seedance-2-mini");
  assert(endpoint !== undefined, "seedance-2-mini must register");
  const request = sealSeedanceRequest("seedance-2-mini", {
    prompt: ["turn"], aspectRatio: ["9:16"], duration: [6], resolution: ["720p"],
    generateAudio: [true], webSearch: [false],
  });
  const { context, checkpoints } = makeContext(server, store.store, canonicalize({ ports: request.ports }));

  const departed = await endpoint.start(context);
  assert.equal(departed.status, "pending", "start must wake poll");
  if (departed.status !== "pending" || departed.handle === undefined) throw new Error("no pending outcome");
  assert.deepEqual(checkpoints[0]?.receipt, { id: "task_kie_1" });
  const submittedBody = server.submitted();
  assert.deepEqual(submittedBody, {
    model: "bytedance/seedance-2-mini",
    input: { prompt: "turn", aspect_ratio: "9:16", duration: 6, resolution: "720p",
      generate_audio: true, web_search: false },
  });

  // Kie is asked with the bearer key, and no media upload happens for a prompt-only run.
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0]?.authorization, `Bearer ${SERVICE_KEY}`);

  const pollContext = { ...context, handle: departed.handle } as unknown as Parameters<typeof endpoint.poll>[0];
  const afterWaiting = await endpoint.poll(pollContext);
  assert.equal(afterWaiting.status, "pending");
  const afterSuccess = await endpoint.poll(pollContext);
  assert.equal(afterSuccess.status, "ready");
  if (afterSuccess.status !== "ready" || afterSuccess.handle === undefined) throw new Error("no ready outcome");
  const readyHandle = canonicalize(afterSuccess.handle) as unknown as { urls?: readonly string[] };
  assert.deepEqual(readyHandle.urls, [RESULT_URL]);

  const collectContext = { ...context, handle: afterSuccess.handle } as unknown as Parameters<typeof endpoint.poll>[0];
  const fulfilled = await endpoint.collect?.(collectContext);
  assert(fulfilled !== undefined && fulfilled.status === "completed", "collect must complete");
  if (fulfilled === undefined || fulfilled.status !== "completed") throw new Error("no completion");
  const fullfilledResult = (fulfilled.result as { readonly value: unknown }).value as {
    readonly kind: string; readonly value: unknown;
  };
  assert.equal(fullfilledResult.kind, "inline", "generation results travel inline");
  const value = fullfilledResult.value;
  verifyGeneratedVideoSet(value);
  assert.deepEqual(value, { videos: [{ kind: "blob", resource: "res_kie_out_1", size: DOWNLOAD_BYTES.byteLength,
    mediaType: "video/mp4" }] });
  assert.deepEqual(store.stored[0]?.mediaType, "video/mp4");
});

test("a failed task record becomes the failure with Kie's stable evidence", async () => {
  const server = makeServer(["fail"]);
  const { endpointOf } = await makeProvider(server);
  const endpoint = endpointOf("@hypit/seedance", "seedance-2-mini");
  assert(endpoint !== undefined);
  const request = sealSeedanceRequest("seedance-2-mini", {
    prompt: ["turn"], aspectRatio: ["9:16"], duration: [6], resolution: ["720p"],
    generateAudio: [true], webSearch: [false],
  });
  const store = makeStore(new Uint8Array([1, 2, 3]));
  const started = await endpoint.start(makeContext(server, store.store, canonicalize({ ports: request.ports })).context);
  assert(started.status === "pending");
  const pollContext = { ...makeContext(server, store.store, canonicalize({ ports: request.ports })).context,
    handle: started.handle } as unknown as Parameters<typeof endpoint.poll>[0];
  const outcome = await endpoint.poll(pollContext);
  assert.deepEqual(outcome, {
    status: "failed", receipt: { id: "task_kie_1" },
    failure: { code: "Generate Media Error", message: "Kie task task_kie_1 failed; Generate Media Error: prompt contained blocked words" },
  });
});

test("an unknown Kie state fails the task instead of hanging", async () => {
  const server = makeServer(["disappeared"]);
  const { endpointOf } = await makeProvider(server);
  const endpoint = endpointOf("@hypit/seedance", "seedance-2-mini");
  assert(endpoint !== undefined);
  const request = sealSeedanceRequest("seedance-2-mini", {
    prompt: ["turn"], aspectRatio: ["9:16"], duration: [6], resolution: ["720p"],
    generateAudio: [true], webSearch: [false],
  });
  const storeCtx = makeContext(server, makeStore(new Uint8Array([1, 2, 3])).store,
    canonicalize({ ports: request.ports }));
  const started = await endpoint.start(storeCtx.context);
  assert(started.status === "pending");
  const outcome = await endpoint.poll({ ...storeCtx.context, handle: started.handle } as unknown as
    Parameters<typeof endpoint.poll>[0]);
  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") {
    assert.match(outcome.failure.message, /unknown task state/u);
  }
});

test("the provider reads live credits as its pricing material", async () => {
  const server = makeServer(["waiting"]);
  const { provider } = await makeProvider(server);
  const documents = await provider.readPricing?.({
    request: { capability, returns: { module: { name: "@hypit/generation", version: "1" }, name: "GeneratedVideoSet" },
      constraints: canonicalize({ ports: {} }) },
    credentials: async () => ({ apiKey: { secret: SERVICE_KEY } }),
  });
  assert.deepEqual(documents, [{
    source: "https://api.kie.ai/api/v1/chat/credit",
    data: { remainingCredits: 2145 },
    summary: "Kie reports 2145 credit(s) remaining",
  }]);
});
