import { defineExactModelModule } from "@hypit/generation/model";
import type { GenerationPortValue, GenerationRequest } from "@hypit/generation";
import type { SurfaceAttributeVocabulary, SurfaceChildVocabulary } from "@hypit/hypit/markup";
import { blobTypes } from "@hypit/hypit/blob";
import { textTypes } from "@hypit/hypit/text";

import {
  generateLyricsCapabilityEntry, generateLyricsProducerEntry, sunoLyricsPlannedNeeds, sunoLyricsProducers,
} from "./lyrics.js";
import { sunoModuleRef } from "./module.js";
import { generateMusicPorts, generateSoundsPorts } from "./ports.js";

/**
 * Suno's music surface as Kie's `ai-music-api/*` Market routes document it.
 * `generate-music` and `generate-sounds` return audio tracks and ride the exact
 * model machinery; `generate-lyrics` is a text product (`resultJson.resultObject
 * .lyricsData[]` per its docs page) and is declared as its own Text capability.
 */
const sunoBaseDefinition = defineExactModelModule({
  module: sunoModuleRef,
  endpoints: [{
    key: "music",
    requestTypeName: "SunoGenerateMusicRequest",
    producerName: "request-generate-music",
    ports: generateMusicPorts,
  }, {
    key: "sounds",
    requestTypeName: "SunoGenerateSoundsRequest",
    producerName: "request-generate-sounds",
    ports: generateSoundsPorts,
  }],
});

export const sunoEndpoints = sunoBaseDefinition.endpoints;
export const sunoFacet = sunoBaseDefinition.facet;

export function sealGenerateMusicRequest(
  ports: Readonly<Record<string, readonly GenerationPortValue[]>>,
): GenerationRequest {
  return sunoEndpoints.music.sealRequest(ports);
}

export function sealGenerateSoundsRequest(
  ports: Readonly<Record<string, readonly GenerationPortValue[]>>,
): GenerationRequest {
  return sunoEndpoints.sounds.sealRequest(ports);
}

export const sunoManifest = {
  ...sunoBaseDefinition.manifest,
  capabilities: [...sunoBaseDefinition.manifest.capabilities, generateLyricsCapabilityEntry],
  producers: [...sunoBaseDefinition.manifest.producers, generateLyricsProducerEntry],
};

export const sunoComponent = {
  ...sunoBaseDefinition.component,
  producers: [...sunoBaseDefinition.component.producers, ...sunoLyricsProducers],
  plannedNeeds: [...(sunoBaseDefinition.component.plannedNeeds ?? []), ...sunoLyricsPlannedNeeds],
};

const musicAttributes: readonly SurfaceAttributeVocabulary[] = [
  { name: "id", kind: "identifier", required: true,
    summary: "Names this generation and prefixes the bindings it publishes." },
  { name: "model", kind: "literal", required: true, values: ["V6", "V6_MINI", "V6_WILD"],
    summary: "The Suno version this request renders with." },
  { name: "custom-mode", kind: "literal", required: true, values: ["true", "false"],
    summary: "Custom mode controls the track by hand; non-custom mode lets the model write the lyrics." },
  { name: "instrumental", kind: "literal", required: true, values: ["true", "false"],
    summary: "Renders an instrumental track with no vocals." },
  { name: "prompt", kind: "reference", required: false, accepts: [textTypes.text],
    summary: "The lyrics in custom mode, or the core idea in non-custom mode." },
  { name: "lyrics", kind: "reference", required: false, accepts: [textTypes.text],
    summary: "The sung lyrics; they take priority over the prompt in custom mode." },
  { name: "style", kind: "reference", required: false, accepts: [textTypes.text],
    summary: "The music style the track should follow." },
  { name: "title", kind: "reference", required: false, accepts: [textTypes.text],
    summary: "The track title; custom mode requires it." },
  { name: "negative-tags", kind: "reference", required: false, accepts: [textTypes.text],
    summary: "Styles or traits to keep out of the track." },
  { name: "vocal-gender", kind: "literal", required: false, values: ["m", "f"],
    summary: "A vocal preference; the model only raises the probability of following it." },
  { name: "style-weight", kind: "literal", required: false,
    summary: "How strongly the track follows the stated style, from 0 to 1." },
  { name: "weirdness-constraint", kind: "literal", required: false,
    summary: "How far the track may stray from the request, from 0 to 1." },
  { name: "audio-weight", kind: "literal", required: false,
    summary: "The relative weight of the audio features, from 0 to 1; a track without vocals ignores it." },
  { name: "variety", kind: "literal", required: false,
    summary: "How much the results differ, from 0 (exact style) to 4 (maximum variation)." },
  { name: "persona-id", kind: "literal", required: false,
    summary: "A persona or voice id the track should use." },
  { name: "persona-model", kind: "literal", required: false, values: ["style_persona", "voice_persona"],
    summary: "What kind of persona the stated id names." },
  { name: "duration", kind: "literal", required: false,
    summary: "The target length in seconds, from 10 to 360; custom mode only." },
];

const soundsAttributes: readonly SurfaceAttributeVocabulary[] = [
  { name: "id", kind: "identifier", required: true,
    summary: "Names this generation and prefixes the bindings it publishes." },
  { name: "prompt", kind: "reference", required: true, accepts: [textTypes.text],
    summary: "The sound effect the model renders." },
  { name: "model", kind: "literal", required: true, values: ["V6", "V6_MINI", "V6_WILD"],
    summary: "The Suno version this request renders with." },
  { name: "sound-loop", kind: "literal", required: false, values: ["true", "false"],
    summary: "Renders a sound that loops seamlessly." },
  { name: "sound-tempo", kind: "literal", required: false,
    summary: "The tempo in BPM, from 1 to 300; the model chooses one when it is absent." },
  { name: "sound-key", kind: "literal", required: false,
    values: ["Any", "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm",
      "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
    summary: "The key the sound is rendered in." },
  { name: "grab-lyrics", kind: "literal", required: false, values: ["true", "false"],
    summary: "Keeps any lyrics the model hears in the sound." },
];

const referenceChildren: readonly SurfaceChildVocabulary[] = [
  { tag: "Reference", cardinality: "many",
    summary: "Attaches one media Artifact the request uses as a reference.",
    attributes: [
      { name: "kind", kind: "literal", required: true, values: ["image", "video", "audio"],
        summary: "Which media port this reference contributes to." },
      { name: "media", kind: "reference", required: true, accepts: [blobTypes.blob],
        summary: "Selects the media Artifact this reference contributes." },
    ] },
];

const musicSurface = {
  name: "music",
  tag: "Music",
  mode: "structured" as const,
  outputs: [sunoEndpoints.music!.draftType, sunoEndpoints.music!.mediaBindings.imageUrls!.type],
  vocabulary: {
    summary: "Generates one music track with the exact Suno model from a text request and optional reference media.",
    attributes: musicAttributes,
    children: referenceChildren,
    ports: [{
      name: "audio",
      type: blobTypes.blob,
      summary: "The generated track, addressed as `<id>.audio`.",
    }],
    example: `<suno:Music
  id="bed"
  model="V6"
  custom-mode="true"
  instrumental="true"
  title="Bed"
  style="Late night electronic, 120 BPM"
/>`,
    notes: [
      "Custom mode requires `title` and at least one of `style`, `lyrics` or `negative-tags`; non-custom mode requires at least one of the reference media, `style` or `lyrics`.",
      "The reference media are effective in non-custom mode only; the custom-mode-only settings must not be stated there.",
      "`duration`, `vocal-gender`, `style-weight`, `weirdness-constraint`, `audio-weight` and `variety` are effective in custom mode only.",
      "The Surface lowers the element into the package's exact model request and selects no Provider.",
    ],
  },
};

const soundsSurface = {
  name: "sounds",
  tag: "Sounds",
  mode: "structured" as const,
  outputs: [sunoEndpoints.sounds!.draftType],
  vocabulary: {
    summary: "Generates one sound effect with the exact Suno model from a text description.",
    attributes: soundsAttributes,
    children: [],
    ports: [{
      name: "audio",
      type: blobTypes.blob,
      summary: "The generated sound, addressed as `<id>.audio`.",
    }],
    example: `<suno:Sounds
  id="tap"
  prompt="A soft UI tap on glass"
  model="V6"
  sound-loop="true"
/>`,
    notes: [
      "The element accepts no children and no text content.",
      "The Surface lowers the element into the package's exact model request and selects no Provider.",
    ],
  },
};

export const sunoMarkupSurfaces = [musicSurface, soundsSurface] as const;

export { sunoModuleRef } from "./module.js";
export {
  generateLyricsCapability, generateLyricsProducers, sunoGenerateLyricsRequest,
} from "./lyrics.js";
export type { SunoGenerateLyricsRequest } from "./lyrics.js";
export { generateMusicPorts, generateSoundsPorts } from "./ports.js";
