import { blobTypes } from "@hypit/hypit/blob";
import { sealGenerationRequestDraft } from "@hypit/generation";
import type { GenerationPortValue } from "@hypit/generation";
import { createExactModelPrimaryGenerationFragment } from "@hypit/generation/model";
import type { ExactModelEndpoint } from "@hypit/generation/model";
import type { CanonicalValue, TypeRef } from "@hypit/hypit/protocol";
import type { StructuredElement, StructuredSurfaceHandler, SurfaceResolvedReference } from "@hypit/hypit/markup";

import { geminiTtsEndpoints } from "./index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function exact(element: StructuredElement, allowed: readonly string[], required: readonly string[]): void {
  const unknown = Object.keys(element.attributes).filter((name) => !allowed.includes(name));
  assert(unknown.length === 0, `${element.name} does not accept ${unknown[0]}`);
  const missing = required.filter((name) => element.attributes[name] === undefined);
  assert(missing.length === 0, `${element.name} requires ${missing.join(", ")}`);
}

function text(element: StructuredElement, name: string): string {
  const value = element.attributes[name];
  assert(typeof value === "string" && value.trim().length > 0, `${element.name}.${name} must be text`);
  return value.trim();
}

function optionalText(element: StructuredElement, name: string): string | undefined {
  return element.attributes[name] === undefined ? undefined : text(element, name);
}

function optionalNumber(element: StructuredElement, name: string): number | undefined {
  if (element.attributes[name] === undefined) return undefined;
  const value = text(element, name);
  assert(/^\d+(?:\.\d+)?$/u.test(value), `${element.name}.${name} must be a number`);
  return Number(value);
}

function optionalBoolean(element: StructuredElement, name: string): boolean | undefined {
  if (element.attributes[name] === undefined) return undefined;
  const value = text(element, name);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${element.name}.${name} must be true or false`);
}

type Turn = { speaker: string; voice: string; text: string; style?: string };

function turns(element: StructuredElement): readonly Turn[] {
  const found: Turn[] = [];
  for (const child of element.children) {
    if (child.kind === "text") {
      assert(child.value.trim().length === 0, `${element.name} accepts only Turn children`);
      continue;
    }
    assert(child.name.endsWith("Turn"), `${element.name} accepts only Turn children`);
    exact(child, ["speaker", "voice", "text", "style"], ["speaker", "voice", "text"]);
    assert(!child.children.some((item) => item.kind === "element" || item.value.trim().length > 0), `${child.name} must be empty`);
    const style = optionalText(child, "style");
    found.push({
      speaker: text(child, "speaker"),
      voice: text(child, "voice"),
      text: text(child, "text"),
      ...(style === undefined ? {} : { style }),
    });
  }
  return found;
}

function decoder(endpoint: ExactModelEndpoint, withStyle: boolean): StructuredSurfaceHandler {
  return ({ element }) => {
    exact(element, ["id", "temperature", "scene", "sample-context", "filler-words"],
      ["id"]);
    const id = text(element, "id");
    const spoken = turns(element);
    assert(spoken.length > 0, `${element.name} requires at least one Turn child`);
    assert(spoken.length <= 100, `${element.name} accepts at most 100 Turn children`);
    if (withStyle) {
      for (const turn of spoken) {
        assert(turn.style !== undefined, `${element.name} accepts a style on every Turn`);
      }
    } else {
      for (const turn of spoken) {
        assert(turn.style === undefined, `${element.name} does not accept a style on a Turn`);
      }
    }
    const speakers = [...new Set(spoken.map((turn) => turn.speaker))];
    assert(speakers.length <= 2, `${element.name} accepts at most two speakers`);
    const voiceOf = new Map<string, string>();
    for (const turn of spoken) {
      const existing = voiceOf.get(turn.speaker);
      if (existing !== undefined) {
        assert(existing === turn.voice, `${element.name} gives ${turn.speaker} two different voices`);
      }
      voiceOf.set(turn.speaker, turn.voice);
    }
    const stated: Record<string, readonly GenerationPortValue[] | undefined> = {
      speakerId: speakers,
      speakerVoice: speakers.map((speaker) => voiceOf.get(speaker)!),
      turnSpeakerId: spoken.map((turn) => turn.speaker),
      turnText: spoken.map((turn) => turn.text),
      temperature: optionalNumber(element, "temperature") === undefined ? undefined : [optionalNumber(element, "temperature")!],
    };
    if (withStyle) stated.turnStyle = spoken.map((turn) => turn.style!);
    if (!withStyle) {
      stated.scene = optionalText(element, "scene") === undefined ? undefined : [optionalText(element, "scene")!];
      stated.sampleContext = optionalText(element, "sample-context") === undefined ? undefined : [optionalText(element, "sample-context")!];
    } else {
      stated.fillerWords = optionalBoolean(element, "filler-words") === undefined
        ? undefined
        : [optionalBoolean(element, "filler-words")!];
    }
    const draft = sealGenerationRequestDraft(endpoint.ports, Object.fromEntries(
      Object.entries(stated).filter((entry): entry is [string, readonly GenerationPortValue[]] => entry[1] !== undefined),
    ));
    const records: Array<{ id: string; type: TypeRef; value: { kind: "inline"; value: CanonicalValue }; range: StructuredElement["range"] }> = [{
      id: `${id}.draft`,
      type: endpoint.draftType,
      value: { kind: "inline", value: draft as unknown as CanonicalValue },
      range: element.range,
    }];
    const inputs: Record<string, SurfaceResolvedReference["ref"] | { kind: "record"; id: string }> = {
      draft: { kind: "record", id: `${id}.draft` },
    };
    const fragment = createExactModelPrimaryGenerationFragment(endpoint, [], []);
    return {
      records,
      fragments: [fragment],
      components: [{
        id,
        fragment: fragment.id,
        inputs,
        outputs: { audio: `${id}.audio` },
        range: element.range,
      }],
    };
  };
}

export const decodeGeminiPro25Surface = decoder(geminiTtsEndpoints.pro25!, false);
export const decodeGeminiFlash31Surface = decoder(geminiTtsEndpoints.flash31!, false);
export const decodeGeminiFlash38Surface = decoder(geminiTtsEndpoints.flash38!, true);
export const decodeGeminiFlash38LiteSurface = decoder(geminiTtsEndpoints.flash38Lite!, true);
