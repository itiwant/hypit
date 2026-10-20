import { defineExactModelModule } from "@hypit/generation/model";
import type { GenerationPortValue, GenerationRequest } from "@hypit/generation";
import type { SurfaceAttributeVocabulary, SurfaceChildVocabulary } from "@hypit/hypit/markup";
import { blobTypes } from "@hypit/hypit/blob";
import { textTypes } from "@hypit/hypit/text";

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

const speechAttributes: readonly SurfaceAttributeVocabulary[] = [
  { name: "id", kind: "identifier", required: true,
    summary: "Names this generation and prefixes the bindings it publishes." },
  { name: "text", kind: "reference", required: true, accepts: [textTypes.text],
    summary: "The Text edge holding the words that are spoken." },
  { name: "voice", kind: "literal", required: false, values: [...ELEVENLABS_VOICE_IDS],
    summary: "The voice that speaks the text; multilingual-v2 requires it." },
  { name: "stability", kind: "literal", required: false,
    summary: "How steady the delivery stays, from 0 to 1." },
  { name: "similarity-boost", kind: "literal", required: false,
    summary: "How closely the delivery matches the voice, from 0 to 1." },
  { name: "style", kind: "literal", required: false,
    summary: "How much style the delivery carries, from 0 to 1." },
  { name: "speed", kind: "literal", required: false,
    summary: "The speaking rate, from 0.7 to 1.2." },
  { name: "timestamps", kind: "literal", required: false, values: ["true", "false"],
    summary: "Asks the service for word timings in the result." },
  { name: "previous-text", kind: "literal", required: false,
    summary: "The text before this one, so the delivery stays continuous." },
  { name: "next-text", kind: "literal", required: false,
    summary: "The text after this one, so the delivery stays continuous." },
  { name: "language-code", kind: "literal", required: false,
    summary: "The spoken language code; only Turbo 2.5 accepts one." },
];

const dialogueChildren: readonly SurfaceChildVocabulary[] = [
  { tag: "Turn", cardinality: "many",
    summary: "One spoken turn of the dialogue.",
    attributes: [
      { name: "text", kind: "literal", required: true,
        summary: "The words this turn speaks." },
      { name: "voice", kind: "literal", required: true,
        summary: "The voice that speaks this turn." },
    ] },
];

const surface = (
  name: string,
  tag: string,
  endpoint: (typeof elevenLabsTtsEndpoints)["multilingual" | "turbo" | "dialogue" | "isolation"],
  summary: string,
  attributes: readonly SurfaceAttributeVocabulary[],
  children: readonly SurfaceChildVocabulary[],
  example: string,
  notes: readonly string[],
) => ({
  name,
  tag,
  mode: "structured" as const,
  outputs: [endpoint!.draftType],
  vocabulary: {
    summary,
    attributes,
    children,
    ports: [{
      name: "audio",
      type: blobTypes.blob,
      summary: "The generated speech, addressed as `<id>.audio`.",
    }],
    example,
    notes: [
      ...notes,
      "The Surface lowers the element into the package's exact model request and selects no Provider.",
    ],
  },
});

export const elevenLabsTtsMarkupSurfaces = [
  surface("speech", "Speech", elevenLabsTtsEndpoints.multilingual!,
    "Speaks one passage with the exact ElevenLabs multilingual-v2 model.",
    speechAttributes, [],
    `<eleven:Speech
  id="narration"
  text={narration}
  voice="Rachel"
/>`,
    ["The element accepts no children and no text content."]),
  surface("turbo", "Turbo", elevenLabsTtsEndpoints.turbo!,
    "Speaks one passage with the exact ElevenLabs turbo-2-5 model.",
    speechAttributes, [],
    `<eleven:Turbo
  id="narration"
  text={narration}
  voice="Rachel"
  language-code="vi"
/>`,
    ["The element accepts no children and no text content."]),
  surface("dialogue", "Dialogue", elevenLabsTtsEndpoints.dialogue!,
    "Speaks a multi-voice dialogue with the exact ElevenLabs text-to-dialogue-v3 model.",
    [
      { name: "id", kind: "identifier", required: true,
        summary: "Names this generation and prefixes the bindings it publishes." },
      { name: "stability", kind: "literal", required: false, values: ["0", "0.5", "1"],
        summary: "How steady the delivery stays." },
      { name: "language-code", kind: "literal", required: false, values: [...ELEVENLABS_DIALOGUE_LANGUAGE_CODES],
        summary: "The spoken language of the dialogue." },
    ],
    dialogueChildren,
    `<eleven:Dialogue id="exchange">
  <eleven:Turn text="Are we ready?" voice="Rachel"/>
  <eleven:Turn text="Ready." voice="Adam"/>
</eleven:Dialogue>`,
    ["Each `Turn` needs its own text and voice; the turns are spoken in order."]),
  surface("isolation", "Isolation", elevenLabsTtsEndpoints.isolation!,
    "Cleans one recording with the exact ElevenLabs audio-isolation model.",
    [
      { name: "id", kind: "identifier", required: true,
        summary: "Names this generation and prefixes the bindings it publishes." },
      { name: "source", kind: "reference", required: true, accepts: [blobTypes.blob],
        summary: "The audio Artifact to clean." },
    ],
    [],
    `<eleven:Isolation id="clean" source={recording}/>`,
    ["The element accepts no children and no text content."]),
] as const;
