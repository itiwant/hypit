import { defineExactModelModule } from "@hypit/generation/model";
import type { GenerationPortValue, GenerationRequest } from "@hypit/generation";

import {
  audioIsolationPortTable, dialogueV3PortTable, multilingualV2PortTable, turbo25PortTable,
} from "./ports.js";
import { ELEVENLABS_DIALOGUE_LANGUAGE_CODES, ELEVENLABS_VOICE_IDS } from "./voices.js";

export const elevenLabsTtsModuleRef = { name: "@hypit/elevenlabs-tts", version: "1" } as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * dialogue-v3's pairing rule: the two parallel arrays must zip one-to-one and
 * their combined text stays inside the page's 5000-character budget.
 */
function validateDialogueV3(request: GenerationRequest): void {
  const texts = request.ports.dialogueText ?? [];
  const voices = request.ports.dialogueVoice ?? [];
  assert(texts.length === voices.length,
    `text-to-dialogue-v3 pairs dialogueText with dialogueVoice; received ${texts.length} text(s) and ${voices.length} voice(s)`);
  let total = 0;
  for (const item of texts) total += String(item).length;
  assert(total <= 5000, `text-to-dialogue-v3 dialogue text must total at most 5000 characters; received ${total}`);
}

const elevenLabsTtsDefinition = defineExactModelModule({
  module: elevenLabsTtsModuleRef,
  endpoints: [{
    key: "multilingual",
    requestTypeName: "ElevenLabsMultilingualV2Request",
    producerName: "request-text-to-speech-multilingual-v2",
    ports: multilingualV2PortTable(),
  }, {
    key: "turbo",
    requestTypeName: "ElevenLabsTurbo25Request",
    producerName: "request-text-to-speech-turbo-2-5",
    ports: turbo25PortTable(),
  }, {
    key: "dialogue",
    requestTypeName: "ElevenLabsDialogueV3Request",
    producerName: "request-text-to-dialogue-v3",
    ports: dialogueV3PortTable(),
    validateRequest: validateDialogueV3,
    validateInputs: (draft) => {
      const texts = draft.ports.dialogueText ?? [];
      const voices = draft.ports.dialogueVoice ?? [];
      if (texts.length > 0 && voices.length > 0) {
        assert(texts.length === voices.length,
          `text-to-dialogue-v3 pairs dialogueText with dialogueVoice; received ${texts.length} text(s) and ${voices.length} voice(s)`);
      }
    },
  }, {
    key: "isolation",
    requestTypeName: "ElevenLabsAudioIsolationRequest",
    producerName: "request-audio-isolation",
    ports: audioIsolationPortTable(),
  }],
});

export const elevenLabsTtsEndpoints = elevenLabsTtsDefinition.endpoints;
export const elevenLabsTtsComponent = elevenLabsTtsDefinition.component;
export const elevenLabsTtsFacet = elevenLabsTtsDefinition.facet;
export const elevenLabsTtsManifest = elevenLabsTtsDefinition.manifest;

const sealByModel = {
  "text-to-speech-multilingual-v2": elevenLabsTtsEndpoints.multilingual,
  "text-to-speech-turbo-2-5": elevenLabsTtsEndpoints.turbo,
  "text-to-dialogue-v3": elevenLabsTtsEndpoints.dialogue,
  "audio-isolation": elevenLabsTtsEndpoints.isolation,
} as const;

export function sealElevenLabsTtsRequest(
  model: keyof typeof sealByModel,
  ports: Readonly<Record<string, readonly GenerationPortValue[]>>,
): GenerationRequest {
  return sealByModel[model].sealRequest(ports);
}

export { audioIsolationPortTable, dialogueV3PortTable, multilingualV2PortTable, turbo25PortTable } from "./ports.js";
export { elevenLabsTtsPorts } from "./ports.js";
export { ELEVENLABS_DIALOGUE_LANGUAGE_CODES, ELEVENLABS_VOICE_IDS } from "./voices.js";
