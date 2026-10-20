import { defineExactModelModule } from "@hypit/generation/model";
import type { GenerationPortValue, GenerationRequest, GenerationRequestDraft } from "@hypit/generation";

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
