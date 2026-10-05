import { EndpointHttpError, EndpointResponseError, EndpointTransportError, retryAfterMs, transport } from "@hypit/endpoint-kit";
import { requestDeadline } from "@hypit/runtime-kit";
import type { CanonicalValue } from "@hypit/protocol";
import { KieHttpError, kieEnvelopeCodeName } from "./errors.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function object(value: unknown, subject: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${subject} must be an object`);
  return value as Record<string, unknown>;
}

function envelope(value: unknown, subject: string): Record<string, unknown> {
  const body = object(value, subject);
  const code = body.code;
  assert(typeof code === "number" && Number.isInteger(code), `${subject} has no numeric result code`);
  assert(body.success === undefined ? code === 200 : body.success === true,
    `${subject} returned ${code}: ${typeof body.msg === "string" ? body.msg : "no message"}`);
  return body;
}

/** Kie's endpoints, values and helper for uploaded text. */
function text(value: unknown, subject: string): string {
  assert(typeof value === "string" && value.trim().length > 0, `${subject} is missing`);
  return value.trim();
}

/**
 * The wire client of the Kie.ai Market API.
 *
 * Every call is one bearer-authenticated request with a request deadline. Kie answers each Market
 * submission and upload synchronously with an envelope; generation unfolds over the unified
 * `recordInfo` query that every model shares.
 */
export class KieClient {
  constructor(
    /** The task API host; Kie's OpenAPI documents `https://api.kie.ai` for every cover. */
    readonly baseUrl: string,
    /** The File Upload host; its OpenAPI server list also says `https://api.kie.ai`, while one curl
     * example in Kie's pages targets `https://kieai.redpandaai.co`. This Provider defaults to the
     * documented server and lets a Runtime Profile override the host when reality disagrees. */
    readonly uploadBaseUrl: string,
    readonly timeoutMs: number,
    readonly fetcher: typeof globalThis.fetch,
  ) {}

  private async request(path: string, key: string, init: RequestInit, subject: string): Promise<unknown> {
    const deadline = requestDeadline(this.timeoutMs, () => new EndpointTransportError(`Kie ${subject} timed out`));
    try {
      const response = await transport(deadline.wait(this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        signal: deadline.signal,
        headers: { authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
      })));
      if (!response.ok) throw this.httpFailure(response, init.method ?? "GET", path, subject);
      const body = await transport(deadline.wait(response.json()));
      return body;
    } finally { deadline.finish(); }
  }

  private httpFailure(response: Response, method: string, path: string, subject: string): EndpointHttpError {
    const evidence = `${subject} ${method} ${path} returned HTTP ${response.status}`;
    return new KieHttpError(
      kieEnvelopeCodeName(response.status), evidence, response.status, retryAfterMs(response.headers),
    );
  }

  /** `POST /api/v1/jobs/createTask` — the Market submission every model shares. Kie has no
   * Idempotency-Key, so the caller checkpoints the returned taskId before saying anything else. */
  async createTask(key: string, model: string, input: CanonicalValue): Promise<string> {
    const body = envelope(await this.request("/api/v1/jobs/createTask", key, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input }),
    }, "task creation"), "Kie task creation");
    return text(object(body.data, "Kie task creation data").taskId, "Kie taskId");
  }

  /** `GET /api/v1/jobs/recordInfo?taskId=` — one unified status query every Market model shares. */
  async recordInfo(key: string, taskId: string): Promise<Record<string, unknown>> {
    const body = envelope(await this.request(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, key, {
      method: "GET",
    }, "task query"), "Kie task query");
    return object(body.data, "Kie task record");
  }

  /** `GET /api/v1/chat/credit` — the remaining balance; `data` is a bare integer in Kie's schema. */
  async credits(key: string): Promise<number> {
    const body = envelope(await this.request("/api/v1/chat/credit", key, { method: "GET" }, "credit query"), "Kie credit query");
    const data = body.data;
    assert(typeof data === "number" && Number.isFinite(data), "Kie credit query returned no number");
    return data;
  }

  /** `POST /api/v1/common/download-url` — one fresh 20-minute link for items Kie itself generated. */
  async downloadLink(key: string, generatedUrl: string): Promise<string> {
    const body = envelope(await this.request("/api/v1/common/download-url", key, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: generatedUrl }),
    }, "download link"), "Kie download link");
    return text(body.data, "Kie download link");
  }

  /** One File Upload round trip; `data.downloadUrl` is the public media URL the Market inputs expect. */
  async uploadMedia(key: string, bytes: Uint8Array, mediaType: string): Promise<string> {
    const large = bytes.byteLength > 10 * 1_000_000;
    const path = large ? "/api/file-stream-upload" : "/api/file-base64-upload";
    const init: RequestInit = large ? {
      method: "POST",
      body: uploadStreamForm(bytes, mediaType),
    } : {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ base64Data: Buffer.from(bytes).toString("base64"), uploadPath: "hypit/reference" }),
    };
    const deadline = requestDeadline(this.timeoutMs, () => new EndpointTransportError("Kie file upload timed out"));
    try {
      const response = await transport(deadline.wait(this.fetcher(`${this.uploadBaseUrl}${path}`, {
        ...init, signal: deadline.signal, headers: { authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
      })));
      if (!response.ok) throw this.httpFailure(response, init.method ?? "POST", path, "Kie file upload");
      const body = envelope(await transport(deadline.wait(response.json())), "Kie file upload");
      const downloadUrl = text(object(body.data, "Kie upload result").downloadUrl, "Kie upload downloadUrl");
      try { new URL(downloadUrl); } catch { throw new EndpointResponseError("Kie upload returned no usable downloadUrl"); }
      return downloadUrl;
    } finally { deadline.finish(); }
  }
}

function uploadStreamForm(bytes: Uint8Array, mediaType: string): FormData {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: mediaType }), "reference");
  form.set("uploadPath", "hypit/reference");
  return form;
}

/** The market result envelope of one completed task, decoded once at the service boundary.
 * Kie documents the URLs inside `data.response.resultUrls`; some task pages also carry the raw
 * models' envelope as `resultJson`, so this helper prefers the documented shape and falls back. */
export function kieResultUrls(record: Record<string, unknown>): readonly string[] {
  const response = record.response;
  if (response !== null && typeof response === "object") {
    const urls = (response as Record<string, unknown>).resultUrls;
    if (Array.isArray(urls) && urls.length > 0 && urls.every((url) => typeof url === "string" && /^https?:\/\//u.test(url))) {
      return urls.map((url) => new URL(url).href);
    }
  }
  const raw = typeof record.resultJson === "string" ? record.resultJson : undefined;
  assert(raw !== undefined && raw.trim().length > 0, "Kie task succeeded without a resultJson payload");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    throw new EndpointResponseError("Kie task resultJson is not valid JSON");
  }
  const urls = object(parsed, "Kie task result").resultUrls;
  assert(Array.isArray(urls) && urls.length > 0 && urls.every((url) => typeof url === "string" && /^https?:\/\//u.test(url)),
    "Kie task result contains no usable resultUrls");
  return urls.map((url) => new URL(url).href);
}
