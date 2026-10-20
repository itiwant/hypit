import { defineExactModelModule } from "@hypit/generation/model";
import type { GenerationPortValue, GenerationRequest, GenerationRequestDraft } from "@hypit/generation";
import type { SurfaceAttributeVocabulary, SurfaceChildVocabulary } from "@hypit/hypit/markup";
import { blobTypes } from "@hypit/hypit/blob";

import {
  gemini25ProTtsPortTable, gemini31FlashTtsPortTable, gemini38FlashLiteTtsPortTable, gemini38FlashTtsPortTable,
} from "./ports.js";
import { GEMINI_38_VOICES, GEMINI_FLASH_VOICES } from "./voices.js";

export const geminiTtsModuleRef = { name: "@hypit/gemini-tts", version: "1" } as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function values(draft: Pick<GenerationRequestDraft, "ports">, name: string): readonly (string | number | boolean)[] {
  return (draft.ports[name] ?? []) as readonly (string | number | boolean)[];
}

/**
 * The zipped ports must agree: one voice per declared speaker, one speaker id
 * per turn (and one style per turn on 3.8), every turn speaking as a declared
 * speaker, ids in the documented "Speaker N" shape.
 */
function validateGeminiShape(withStyle: boolean) {
  return (input: GenerationRequest | GenerationRequestDraft): void => {
    const speakerIds = values(input, "speakerId").map(String);
    const speakerVoices = values(input, "speakerVoice").map(String);
    const turnSpeakerIds = values(input, "turnSpeakerId").map(String);
    const turnTexts = values(input, "turnText");
    const turnStyles = values(input, "turnStyle");
    if (speakerVoices.length > 0 && speakerIds.length > 0) {
      assert(speakerVoices.length === speakerIds.length,
        `gemini-tts speakers pair speakerId with speakerVoice; received ${speakerIds.length} id(s) and ${speakerVoices.length} voice(s)`);
    }
    if (turnSpeakerIds.length > 0 && turnTexts.length > 0) {
      assert(turnSpeakerIds.length === turnTexts.length,
        `gemini-tts turns pair turnSpeakerId with turnText; received ${turnSpeakerIds.length} id(s) and ${turnTexts.length} text(s)`);
    }
    if (withStyle && turnStyles.length > 0 && turnTexts.length > 0) {
      assert(turnStyles.length === turnTexts.length,
        `gemini-tts turnStyle repeats turnText; received ${turnStyles.length} style(s) for ${turnTexts.length} text(s)`);
    }
    for (const id of speakerIds) {
      assert(/^Speaker \d+$/u.test(id), `gemini-tts speakerId must be "Speaker N"; received ${id}`);
    }
    if (speakerIds.length > 0) {
      for (const id of turnSpeakerIds) {
        assert(speakerIds.includes(id), `gemini-tts turnSpeakerId ${id} names no declared speaker`);
      }
    }
  };
}

const geminiTtsDefinition = defineExactModelModule({
  module: geminiTtsModuleRef,
  endpoints: [{
    key: "pro25",
    requestTypeName: "Gemini25ProTtsRequest",
    producerName: "request-gemini-2-5-pro-tts",
    ports: gemini25ProTtsPortTable(),
    validateRequest: validateGeminiShape(false),
    validateInputs: validateGeminiShape(false),
  }, {
    key: "flash31",
    requestTypeName: "Gemini31FlashTtsRequest",
    producerName: "request-gemini-3-1-flash-tts",
    ports: gemini31FlashTtsPortTable(),
    validateRequest: validateGeminiShape(false),
    validateInputs: validateGeminiShape(false),
  }, {
    key: "flash38",
    requestTypeName: "Gemini38FlashTtsRequest",
    producerName: "request-gemini-3-8-flash-tts",
    ports: gemini38FlashTtsPortTable(),
    validateRequest: validateGeminiShape(true),
    validateInputs: validateGeminiShape(true),
  }, {
    key: "flash38Lite",
    requestTypeName: "Gemini38FlashLiteTtsRequest",
    producerName: "request-gemini-3-8-flash-lite-tts",
    ports: gemini38FlashLiteTtsPortTable(),
    validateRequest: validateGeminiShape(true),
    validateInputs: validateGeminiShape(true),
  }],
});

export const geminiTtsEndpoints = geminiTtsDefinition.endpoints;
export const geminiTtsComponent = geminiTtsDefinition.component;
export const geminiTtsFacet = geminiTtsDefinition.facet;
export const geminiTtsManifest = geminiTtsDefinition.manifest;

const sealByModel = {
  "gemini-2-5-pro-tts": geminiTtsEndpoints.pro25,
  "gemini-3-1-flash-tts": geminiTtsEndpoints.flash31,
  "gemini-3-8-flash-tts": geminiTtsEndpoints.flash38,
  "gemini-3-8-flash-lite-tts": geminiTtsEndpoints.flash38Lite,
} as const;

export function sealGeminiTtsRequest(
  model: keyof typeof sealByModel,
  ports: Readonly<Record<string, readonly GenerationPortValue[]>>,
): GenerationRequest {
  return sealByModel[model].sealRequest(ports);
}

export {
  gemini25ProTtsPortTable, gemini31FlashTtsPortTable, gemini38FlashLiteTtsPortTable, gemini38FlashTtsPortTable,
} from "./ports.js";
export { geminiTtsPorts } from "./ports.js";
export { GEMINI_38_VOICES, GEMINI_FLASH_VOICES } from "./voices.js";

const turnChildren: readonly SurfaceChildVocabulary[] = [
  { tag: "Turn", cardinality: "many",
    summary: "One spoken turn of the dialogue.",
    attributes: [
      { name: "speaker", kind: "literal", required: true,
        summary: "Which declared speaker speaks this turn." },
      { name: "voice", kind: "literal", required: true, values: [...GEMINI_38_VOICES],
        summary: "The voice this speaker speaks with." },
      { name: "text", kind: "literal", required: true,
        summary: "The words this turn speaks." },
      { name: "style", kind: "literal", required: false,
        summary: "How this turn is delivered; the 3.8 models accept one per turn." },
    ] },
];

const geminiAttributes: readonly SurfaceAttributeVocabulary[] = [
  { name: "id", kind: "identifier", required: true,
    summary: "Names this generation and prefixes the bindings it publishes." },
  { name: "temperature", kind: "literal", required: false,
    summary: "How freely the delivery varies, from 0 to 2." },
  { name: "scene", kind: "literal", required: false,
    summary: "The scene the dialogue takes place in; the Pro 2.5 and Flash 3.1 models accept one." },
  { name: "sample-context", kind: "literal", required: false,
    summary: "Context the delivery is measured against; the Pro 2.5 and Flash 3.1 models accept one." },
  { name: "filler-words", kind: "literal", required: false, values: ["true", "false"],
    summary: "Allows conversational fillers; the 3.8 models accept it." },
];

const surface = (
  name: string,
  tag: string,
  endpoint: (typeof geminiTtsEndpoints)["pro25" | "flash31" | "flash38" | "flash38Lite"],
  voices: readonly string[],
  summary: string,
  example: string,
  notes: readonly string[],
) => ({
  name,
  tag,
  mode: "structured" as const,
  outputs: [endpoint!.draftType],
  vocabulary: {
    summary,
    attributes: geminiAttributes,
    children: turnChildren,
    ports: [{
      name: "audio",
      type: blobTypes.blob,
      summary: "The generated speech, addressed as `<id>.audio`.",
    }],
    example,
    notes: [
      ...notes,
      `The available voices are the ${voices.length} the model page documents.`,
      "The Surface lowers the element into the package's exact model request and selects no Provider.",
    ],
  },
});

export const geminiTtsMarkupSurfaces = [
  surface("pro25", "Pro25", geminiTtsEndpoints.pro25!, GEMINI_FLASH_VOICES,
    "Speaks a dialogue with the exact Gemini 2.5 Pro TTS model.",
    `<gemini:Pro25 id="narration">
  <gemini:Turn speaker="Speaker 1" voice="Kore" text="Xin chào, đây là bản thử."/>
</gemini:Pro25>`,
    ["The element accepts at most two speakers and 100 turns."]),
  surface("flash31", "Flash31", geminiTtsEndpoints.flash31!, GEMINI_FLASH_VOICES,
    "Speaks a dialogue with the exact Gemini 3.1 Flash TTS model.",
    `<gemini:Flash31 id="narration">
  <gemini:Turn speaker="Speaker 1" voice="Kore" text="Xin chào, đây là bản thử."/>
</gemini:Flash31>`,
    ["The element accepts at most two speakers and 100 turns."]),
  surface("flash38", "Flash38", geminiTtsEndpoints.flash38!, GEMINI_38_VOICES,
    "Speaks a dialogue with the exact Gemini 3.8 Flash TTS model.",
    `<gemini:Flash38 id="narration">
  <gemini:Turn speaker="Speaker 1" voice="Kore" style="Warm and calm" text="Xin chào."/>
</gemini:Flash38>`,
    ["Every turn needs its own style; the element accepts at most two speakers and 100 turns."]),
  surface("flash38Lite", "Flash38Lite", geminiTtsEndpoints.flash38Lite!, GEMINI_38_VOICES,
    "Speaks a dialogue with the exact Gemini 3.8 Flash Lite TTS model.",
    `<gemini:Flash38Lite id="narration">
  <gemini:Turn speaker="Speaker 1" voice="Kore" style="Warm and calm" text="Xin chào."/>
</gemini:Flash38Lite>`,
    ["Every turn needs its own style; the element accepts at most two speakers and 100 turns."]),
] as const;
