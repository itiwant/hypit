import { EndpointHttpError, EndpointServiceError } from "@hypit/endpoint-kit";

/**
 * Kie's response envelopes and their documented meanings. Task and Common API pages agree on the
 * generation-style enum; the File Upload pages answer with their own smaller enum. `433` exists on
 * most task pages ("Request Limit — the subkey usage exceeded the limit") and `408` appears only in
 * 5xx descriptions, both mapped here for stable names.
 */
const KIE_ENVELOPE_CODES: Readonly<Record<number, string>> = {
  400: "KIE_BAD_REQUEST",
  401: "KIE_UNAUTHORIZED",
  402: "KIE_INSUFFICIENT_QUOTA",
  404: "KIE_NOT_FOUND",
  408: "KIE_UPSTREAM_TIMEOUT",
  405: "KIE_METHOD_NOT_ALLOWED",
  422: "KIE_VALIDATION_ERROR",
  429: "KIE_RATE_LIMITED",
  433: "KIE_SUBKEY_LIMIT",
  455: "KIE_MAINTENANCE",
  500: "KIE_SERVER_ERROR",
  501: "KIE_GENERATION_FAILED",
  505: "KIE_FEATURE_DISABLED",
};

export function kieEnvelopeCodeName(code: number): string {
  return KIE_ENVELOPE_CODES[code] ?? `KIE_HTTP_${code}`;
}

export class KieServiceError extends EndpointServiceError {}

/** A non-success HTTP response from api.kie.ai (or the upload host it documents). */
export class KieHttpError extends EndpointHttpError {}

// Responses may mention a signed asset URL or a rate-limited subkey. Keep the reason, not the URL.
export function safeKieReason(value: string): string {
  return value.replace(/https?:\/\/\S+/giu, "[redacted-url]");
}

/** A terminal `fail` record's stable failure evidence; `undefined` while the task is not failing. */
export type KieTaskFailureShape = { readonly failCode: string; readonly reason: string };

export function kieTaskFailure(record: Record<string, unknown>): KieTaskFailureShape | undefined {
  if (record.state !== "fail") return undefined;
  const failCode = typeof record.failCode === "string" && record.failCode.trim().length > 0
    ? record.failCode.trim()
    : "KIE_GENERATION_FAILED";
  const failMessage = typeof record.failMsg === "string" && record.failMsg.trim().length > 0
    ? record.failMsg.trim()
    : typeof record.resultJson === "string" && record.resultJson.trim().length > 0
    ? record.resultJson
    : "the task failed";
  return { failCode, reason: safeKieReason(failMessage) };
}
