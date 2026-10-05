import type { GenerationArtifactUrlResolver } from "@hypit/generation";
import type { EndpointInvocationContext } from "@hypit/endpoint-kit";
import type { KieMediaLimits } from "./routes.js";
import type { KieClient } from "./client.js";

/**
 * The media transport of the Kie Provider's URL resolver.
 *
 * Kie's Market inputs take media as URLs (file URLs after upload, or `asset://` ids); Kie leaves no
 * inline data-URL path. This resolver therefore uploads each referenced Resource once through the
 * File Upload API — base64 for small files, the multipart stream endpoint past 10 MB as that API
 * documents — and hands every scene the same `downloadUrl`.
 *
 * Per-route byte limits come from the model's spec page; an absent limit carries no documented cap.
 */
export function kieMediaURLResolver(
  client: KieClient,
  context: EndpointInvocationContext,
  limits: KieMediaLimits,
  key: string,
): GenerationArtifactUrlResolver {
  const resolved = new Map<string, Promise<string>>();
  return (artifact) => {
    const existing = resolved.get(artifact.resource);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      const kind = artifact.mediaType.startsWith("image/") ? "image"
        : artifact.mediaType.startsWith("video/") ? "video"
        : artifact.mediaType.startsWith("audio/") ? "audio" : undefined;
      if (kind === undefined) {
        throw new Error(`Kie serves image, video and audio references only; ${artifact.mediaType} is not one`);
      }
      const limit = limits[kind];
      if (limit !== undefined && artifact.size > limit) {
        throw new Error(`Kie accepts ${kind} references up to ${(limit / 1_000_000).toFixed(0)} MB for this model;`
          + ` ${artifact.resource} is ${(artifact.size / 1_000_000).toFixed(2)} MB`);
      }
      const bytes = await context.resources.get(artifact.resource);
      if (bytes === undefined || bytes.byteLength !== artifact.size) {
        throw new Error(`Reference Resource ${artifact.resource} is unavailable or has changed`);
      }
      return await client.uploadMedia(key, bytes, artifact.mediaType);
    })();
    resolved.set(artifact.resource, promise);
    return promise;
  };
}
