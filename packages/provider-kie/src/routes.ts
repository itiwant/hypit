import { generationTypes, mappingSupportsRequest } from "@hypit/generation";
import {
  compileWireRequest, sealGeneratedAudioSet, sealGeneratedImageSet, sealGeneratedVideoSet,
  selectWireModelForRequest,
} from "@hypit/generation";
import type {
  GenerationArtifactUrlResolver, GenerationRequest, GenerationWireMapping,
} from "@hypit/generation";
import { canonicalize } from "@hypit/hypit/protocol";
import type { BlobRef, CapabilityRef, CanonicalValue, StoredValue, TypeRef } from "@hypit/hypit/protocol";
import type { EndpointRequest, EndpointSupport } from "@hypit/hypit/endpoint";
import { kieMappings } from "./mapping.js";

const MB = 1_000_000;

export type KieMediaLimits = {
  readonly image?: number;
  readonly video?: number;
  readonly audio?: number;
};

/** Documented byte limits Kie's Market pages state for one external media file, by wire model. */
const kieMediaLimits: Readonly<Record<string, KieMediaLimits>> = {
  "bytedance/seedance-2": { image: 30 * MB, video: 50 * MB, audio: 15 * MB },
  "bytedance/seedance-2-fast": { image: 30 * MB, video: 50 * MB, audio: 15 * MB },
  "bytedance/seedance-2-mini": { image: 30 * MB, video: 50 * MB, audio: 15 * MB },
  "bytedance/seedance-2-5": { image: 30 * MB, video: 200 * MB, audio: 15 * MB },
  "minimax-h3/reference-to-video": { image: 30 * MB, video: 50 * MB, audio: 15 * MB },
  "minimax-h3/image-to-video": { image: 30 * MB },
  "grok-imagine/image-to-video": { image: 10 * MB },
  "grok-imagine-video-1-5-preview": { image: 20 * MB },
  "nano-banana-2": { image: 30 * MB },
  "nano-banana-pro": { image: 30 * MB },
  "seedream/5-lite-image-to-image": { image: 30 * MB },
  "pixverse-v6/image-to-video": { image: 20 * MB },
  "pixverse-v6/transition": { image: 20 * MB },
  // Non-custom Suno references (docs `suno-api/generate-music.md`).
  "ai-music-api/generate": { image: 10 * MB, video: 100 * MB, audio: 500 * MB },
  "elevenlabs/audio-isolation": { audio: 10 * MB },
};

/** Kie's GPT Image 2 page lists aspect ratios each higher resolution refuses; `1:1` cannot render 4K. */
const GPT_IMAGE_UNAVAILABLE: Readonly<Record<string, readonly string[]>> = {
  "2K": ["5:4", "4:5", "3:1", "1:3", "9:21"],
  "4K": ["1:1", "3:1", "1:3", "9:21"],
};

function scalar(request: GenerationRequest, port: string): string | number | boolean | undefined {
  const value = request.ports[port]?.[0];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function items(request: GenerationRequest, port: string): number {
  return request.ports[port]?.length ?? 0;
}

function present(request: GenerationRequest, port: string): boolean {
  return items(request, port) > 0;
}

/**
 * Where Kie documents a narrower input band than the model declares, the Provider refuses the
 * request with that documented reason instead of widening anything. Each rule cites its spec page.
 */
function rejection(mapping: GenerationWireMapping, request: GenerationRequest): string | undefined {
  const module = mapping.capability.module.name;
  const ratio = scalar(request, "aspectRatio");
  const resolution = scalar(request, "resolution");

  if (module === "@hypit/seedance") {
    const frameOrReference = ["firstFrame", "lastFrame", "referenceImage", "referenceVideo", "referenceAudio"]
      .some((port) => present(request, port));
    if (frameOrReference && scalar(request, "webSearch") === true) {
      return "Kie Seedance takes web_search only in a text-to-video scene";
    }
    return undefined;
  }

  if (module === "@hypit/minimax-h3") {
    if (!["referenceImage", "referenceVideo", "referenceAudio", "firstFrame", "lastFrame"]
      .some((port) => present(request, port))) {
      // Kie's text-to-video route makes aspect_ratio required; the model leaves it optional.
      if (ratio === undefined) return "Kie minimax-h3/text-to-video requires aspect_ratio";
    }
    return undefined;
  }

  if (module === "@hypit/grok-imagine") {
    if (items(request, "images") > 1 && resolution === "1080p") {
      return "Kie Grok Imagine animates exactly one image at 1080p";
    }
    if (mapping.capability.name === "grok-imagine-video-1.5-preview"
      && ratio !== undefined && ratio !== "auto" && items(request, "images") === 1) {
      return "Kie's 1.5 preview reads the aspect ratio only from the single image it animates";
    }
    return undefined;
  }

  if (module === "@hypit/gpt-image") {
    if (ratio === "auto" && resolution !== "1K") return "Kie GPT Image 2 renders aspect-ratio auto only at 1K";
    if (GPT_IMAGE_UNAVAILABLE[String(resolution)]?.includes(String(ratio))) {
      return `Kie GPT Image 2 does not render ${String(ratio)} at ${String(resolution)}`;
    }
    if (scalar(request, "background") !== undefined && resolution !== "1K") {
      return `Kie GPT Image 2 accepts background only at 1K; omit it at ${String(resolution)}`;
    }
    return undefined;
  }

  if (module === "@hypit/wan") {
    // Kie's Wan pages: "(4K generation is available only for text-to-image in Standard Mode)" —
    // with input images the output follows them, and the sequential/group mode cannot use it.
    if (resolution === "4K" && (present(request, "images") || scalar(request, "imageSet") === true)) {
      return "Kie Wan 2.7 renders 4K only for text-to-image in Standard Mode";
    }
    if (present(request, "images") && scalar(request, "extendedReasoning") === true) {
      return "Kie Wan 2.7's thinking_mode applies only without input images";
    }
    const count = scalar(request, "count");
    if (typeof count === "number" && count > 4 && scalar(request, "imageSet") !== true) {
      return "Kie Wan 2.7 renders at most four pictures per request; sequential mode takes up to twelve";
    }
    return undefined;
  }

  if (module === "@hypit/pixverse") {
    // The Fusion rules come first: referenceVideo and an eight-reference run are model-legal but
    // outside Kie's Fusion page, so they must win over the duration and aspect rules below.
    if (present(request, "referenceVideo")) return "Kie's PixVerse Fusion mode takes image references only";
    if (items(request, "referenceImage") > 7) return "Kie's PixVerse Fusion mode takes up to seven reference images";
    if (items(request, "duration") === 0) return "Every Kie PixVerse route takes an explicit duration";
    // The Fusion and text-to-video pages both make aspect_ratio required; the transition inherits
    // its framing from the frame pair and Kie's image-to-video page reads the shape off the image,
    // so neither accepts an aspect_ratio (the model itself forbids the frames-aspect mix).
    if (!present(request, "lastFrame") && !present(request, "firstFrame")) {
      if (ratio === undefined) return "Kie's PixVerse requires a concrete aspect_ratio outside the transition";
      if (ratio === "auto") return "Kie's PixVerse reads no auto aspect ratio without reference videos";
    }
    return undefined;
  }

  if (module === "@hypit/suno" && mapping.capability.name === "generate-music") {
    // docs.kie.ai `suno-api/generate-music.md` — the mode grammar is narrower than the
    // union of ports the model table carries.
    const custom = scalar(request, "customMode") === true;
    const instrumental = scalar(request, "instrumental") === true;
    const refs = ["imageUrls", "videoUrls", "audioUrls"].filter((port) => present(request, port));
    if (instrumental && present(request, "audioWeight")) {
      return "Kie's generate-music does not support audio_weight without vocals";
    }
    if (custom) {
      if (!present(request, "title")) return "Kie's generate-music custom_mode requires a title";
      if (refs.length > 0) return "Kie's generate-music custom_mode takes no image_urls/video_urls/audio_urls references";
      if (!present(request, "style") && !present(request, "lyrics") && !present(request, "negativeTags")) {
        return "Kie's generate-music custom_mode needs at least one of style, lyrics or negative_tags";
      }
    } else {
      const customOnly = ["duration", "vocalGender", "styleWeight", "weirdnessConstraint", "audioWeight", "variety"]
        .find((port) => present(request, port));
      if (customOnly !== undefined) return `Kie's generate-music non-custom mode takes no ${customOnly}`;
      const prompt = scalar(request, "prompt");
      if (typeof prompt === "string" && prompt.length > 3000) {
        return "Kie's generate-music non-custom prompt is capped at 3000 characters";
      }
      if (refs.length === 0 && !present(request, "style") && !present(request, "lyrics")) {
        return "Kie's generate-music non-custom mode needs at least one of image_urls, video_urls, audio_urls, style or lyrics";
      }
    }
    return undefined;
  }

  return undefined;
}

/**
 * Route-specific wire shapes the shared field table cannot express: Kie's PixVerse pages spell
 * reference addresses and frame inputs differently per route.
 */
function normalize(
  mapping: GenerationWireMapping, model: string, input: Record<string, unknown>,
): CanonicalValue {
  if (mapping.capability.module.name === "@hypit/pixverse") {
    if (Array.isArray(input.image_references)) {
      for (let index = 0; index < input.image_references.length; index += 1) {
        const item = input.image_references[index];
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          (item as Record<string, unknown>).ref_name = `ref_${index + 1}`;
        }
      }
    }
    if (model === "pixverse-v6/image-to-video" && typeof input.first_frame_image_url === "string") {
      input.image_urls = [input.first_frame_image_url];
      delete input.first_frame_image_url;
    }
  }
  if (mapping.capability.name === "text-to-dialogue-v3") {
    // `dialogue: [{text, voice}]` comes from the two parallel port arrays.
    const texts = input.dialogue_text;
    const voices = input.dialogue_voice;
    if (Array.isArray(texts) && Array.isArray(voices)) {
      input.dialogue = texts.map((text, index) => ({ text, voice: voices[index] }));
    }
    delete input.dialogue_text;
    delete input.dialogue_voice;
  }
  if (mapping.capability.module.name === "@hypit/gemini-tts") {
    // `speakers: [{speaker_id, voice_name}]` and `dialogue_turns: [{speaker_id, text, style?}]`.
    const ids = input.speaker_id;
    const voices = input.speaker_voice;
    if (Array.isArray(ids)) {
      input.speakers = ids.map((id, index) => ({
        speaker_id: id,
        ...(Array.isArray(voices) && voices[index] !== undefined ? { voice_name: voices[index] } : {}),
      }));
    }
    const turnIds = input.turn_speaker_id;
    const turnTexts = input.turn_text;
    const turnStyles = input.turn_style;
    if (Array.isArray(turnTexts)) {
      input.dialogue_turns = turnTexts.map((text, index) => ({
        speaker_id: Array.isArray(turnIds) ? turnIds[index] : undefined,
        text,
        ...(Array.isArray(turnStyles) && turnStyles[index] !== undefined ? { style: turnStyles[index] } : {}),
      }));
    }
    delete input.speaker_id;
    delete input.speaker_voice;
    delete input.turn_speaker_id;
    delete input.turn_text;
    delete input.turn_style;
  }
  return canonicalize(input);
}

function capabilityKey(capability: CapabilityRef): string {
  return `${capability.module.name}@${capability.module.version}#${capability.name}`;
}

export function kieCapabilityKey(capability: CapabilityRef): string {
  return capabilityKey(capability);
}

export type KiePreparedRequest = {
  readonly model: string;
  readonly mediaLimits: KieMediaLimits;
  readonly compile: (resolve: GenerationArtifactUrlResolver) => Promise<CanonicalValue>;
};

export type KieRoute = GenerationWireMapping & {
  readonly key: string;
  readonly returns: TypeRef;
  readonly supports: (request: EndpointRequest) => EndpointSupport;
  readonly prepare: (constraints: CanonicalValue) => KiePreparedRequest;
  readonly packageResult: (artifacts: readonly BlobRef[]) => StoredValue;
};

/**
 * The route side of every generation capability: support checks against the model's own request,
 * exact wire compilation and sealed result packaging all come from the Endpoint SDK; only Kie's
 * model identifiers, limits and documented narrow rules belong to this package.
 */
export const kieRoutes: readonly KieRoute[] = kieMappings.map((mapping) => ({
  ...mapping,
  key: capabilityKey(mapping.capability),
  returns: mapping.result === "image" ? generationTypes.imageSet
    : mapping.result === "video" ? generationTypes.videoSet : generationTypes.audioSet,
  supports: (request: EndpointRequest): EndpointSupport => {
    const request_ = request.constraints as unknown as GenerationRequest;
    const reason = rejection(mapping, request_);
    return reason === undefined ? (mappingSupportsRequest(mapping, request.constraints)
      ? { status: "supported" as const }
      : { status: "unsupported" as const, reason: `Kie cannot accept one of the inputs of ${mapping.capability.name}` })
      : { status: "unsupported" as const, reason };
  },
  prepare: (constraints) => {
    const request = constraints as unknown as GenerationRequest;
    const reason = rejection(mapping, request);
    if (reason !== undefined) throw new Error(reason);
    const model = selectWireModelForRequest(mapping, request);
    return {
      model,
      mediaLimits: kieMediaLimits[model] ?? {},
      compile: async (resolve) => normalize(mapping, model,
        (await compileWireRequest(mapping, request, resolve)).input as Record<string, unknown>),
    };
  },
  packageResult: (artifacts) => ({
    kind: "inline" as const,
    value: canonicalize(mapping.result === "image"
      ? sealGeneratedImageSet({ images: artifacts })
      : mapping.result === "video"
      ? sealGeneratedVideoSet({ videos: artifacts })
      : sealGeneratedAudioSet({ audios: artifacts })),
  }),
}));

const byCapability = new Map(kieRoutes.map((route) => [route.key, route]));

export function kieRouteForCapability(capability: CapabilityRef): KieRoute | undefined {
  return byCapability.get(capabilityKey(capability));
}
