import { defineExactModelModule } from "@hypit/generation/model";
import type { GenerationPortValue, GenerationRequest } from "@hypit/generation";

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

export { sunoModuleRef } from "./module.js";
export {
  generateLyricsCapability, generateLyricsProducers, sunoGenerateLyricsRequest,
} from "./lyrics.js";
export type { SunoGenerateLyricsRequest } from "./lyrics.js";
export { generateMusicPorts, generateSoundsPorts } from "./ports.js";
