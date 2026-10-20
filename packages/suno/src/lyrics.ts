import type { ProducerHandlerContext } from "@hypit/hypit/producer";
import type { CapabilityRef, ProducerRef } from "@hypit/hypit/protocol";
import { textTypes, verifyText } from "@hypit/hypit/text";

import { sunoModuleRef } from "./module.js";

export const generateLyricsCapability: CapabilityRef = {
  module: sunoModuleRef, name: "generate-lyrics",
};
export const generateLyricsProducers = {
  request: { module: sunoModuleRef, name: "request-generate-lyrics" },
} satisfies Record<string, ProducerRef>;

/** What one lyrics generation asks for; the prompt is the theme, mood or story brief. */
export type SunoGenerateLyricsRequest = {
  readonly prompt: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * One lyrics generation request. docs.kie.ai `suno-api/generate-lyrics.md`:
 * `prompt` describes theme, mood, style or story, at most 200 characters.
 */
export function sunoGenerateLyricsRequest(prompt: string): SunoGenerateLyricsRequest {
  assert(typeof prompt === "string" && prompt.trim().length > 0, "Suno lyrics request needs a prompt");
  assert(prompt.trim().length <= 200, "Kie's generate-lyrics prompt is capped at 200 characters");
  return { prompt: prompt.trim() };
}

/** Producer facet: Text prompt edge in, one lyrics Need out. */
export const sunoLyricsProducers = [{
  producer: generateLyricsProducers.request,
  handler: ({ inputs }: ProducerHandlerContext) => {
    const record = inputs.prompt?.value;
    assert(record !== undefined && record.kind === "inline", "generate-lyrics prompt input is missing");
    verifyText(record.value);
    const text = record.value as unknown as { readonly value: string };
    return { outputs: {}, needs: { lyrics: sunoGenerateLyricsRequest(text.value) } };
  },
}];

export const sunoLyricsPlannedNeeds = [{
  producer: generateLyricsProducers.request,
  port: "lyrics",
  capability: generateLyricsCapability,
  plan: () => ({ constraints: {}, pendingInputs: [] }),
  present: () => ({ fields: {}, references: {} }),
}];

export const generateLyricsCapabilityEntry = {
  name: generateLyricsCapability.name,
  returns: textTypes.text,
};

export const generateLyricsProducerEntry = {
  name: generateLyricsProducers.request.name,
  inputs: [{ name: "prompt", type: textTypes.text }],
  outputs: [],
  needs: [{ name: "lyrics", capability: generateLyricsCapability, returns: textTypes.text }],
};
