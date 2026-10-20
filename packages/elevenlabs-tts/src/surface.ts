import { blobTypes } from "@hypit/hypit/blob";
import { generationPort, sealGenerationMediaBinding, sealGenerationRequestDraft } from "@hypit/generation";
import type { GenerationMediaPort, GenerationPortValue } from "@hypit/generation";
import {
  createExactModelPrimaryGenerationFragment,
  exactModelMediaInputNames,
  exactModelTextInputName,
} from "@hypit/generation/model";
import type { ExactModelEndpoint } from "@hypit/generation/model";
import type { CanonicalValue, TypeRef } from "@hypit/hypit/protocol";
import type { MarkupAttributeValue, StructuredElement, StructuredSurfaceHandler, SurfaceResolvedReference } from "@hypit/hypit/markup";
import { textTypes, verifyText } from "@hypit/hypit/text";

import { elevenLabsTtsEndpoints } from "./index.js";

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

function ref(
  element: StructuredElement,
  name: string,
  type: TypeRef,
  resolve: (path: string) => SurfaceResolvedReference | undefined,
): SurfaceResolvedReference {
  const value: MarkupAttributeValue | undefined = element.attributes[name];
  assert(typeof value === "object" && value.kind === "reference", `${element.name}.${name} must be a reference`);
  const result = resolve(value.path);
  assert(result !== undefined && result.type.name === type.name && result.type.module.name === type.module.name,
    `${element.name}.${name} has the wrong type`);
  return result;
}

function textReference(
  element: StructuredElement,
  name: string,
  resolve: (path: string) => SurfaceResolvedReference | undefined,
): SurfaceResolvedReference {
  const result = ref(element, name, textTypes.text, resolve);
  if (result.record !== undefined) {
    assert(result.record.value.kind === "inline", `${element.name}.${name} must reference Text`);
    verifyText(result.record.value.value);
  }
  return result;
}

const speechAttributes = [
  "id", "text", "voice", "stability", "similarity-boost", "style", "speed",
  "timestamps", "previous-text", "next-text", "language-code",
] as const;

function speechDecoder(endpoint: ExactModelEndpoint, voiceRequired: boolean): StructuredSurfaceHandler {
  return ({ element, resolveReference }) => {
    exact(element, [...speechAttributes], voiceRequired ? ["id", "text", "voice"] : ["id", "text"]);
    const id = text(element, "id");
    const spoken = textReference(element, "text", resolveReference);
    const stated: Record<string, readonly GenerationPortValue[] | undefined> = {
      stability: optionalNumber(element, "stability") === undefined ? undefined : [optionalNumber(element, "stability")!],
      similarityBoost: optionalNumber(element, "similarity-boost") === undefined ? undefined : [optionalNumber(element, "similarity-boost")!],
      style: optionalNumber(element, "style") === undefined ? undefined : [optionalNumber(element, "style")!],
      speed: optionalNumber(element, "speed") === undefined ? undefined : [optionalNumber(element, "speed")!],
      timestamps: optionalBoolean(element, "timestamps") === undefined ? undefined : [optionalBoolean(element, "timestamps")!],
      languageCode: optionalText(element, "language-code") === undefined ? undefined : [optionalText(element, "language-code")!],
    };
    if (element.attributes.voice !== undefined) stated.voice = [text(element, "voice")];
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
      [exactModelTextInputName("text")]: spoken.ref,
    };
    const fragment = createExactModelPrimaryGenerationFragment(endpoint, [], [{ name: "text", port: "text" }]);
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

const dialogueAttributes = ["id", "turn", "stability", "language-code"] as const;

function dialogueDecoder(endpoint: ExactModelEndpoint): StructuredSurfaceHandler {
  return ({ element, resolveReference }) => {
    exact(element, [...dialogueAttributes], ["id"]);
    const id = text(element, "id");
    const turns: Array<{ text: string; voice: string }> = [];
    for (const child of element.children) {
      if (child.kind === "text") {
        assert(child.value.trim().length === 0, `${element.name} accepts only Turn children`);
        continue;
      }
      assert(child.name.endsWith("Turn"), `${element.name} accepts only Turn children`);
      exact(child, ["text", "voice"], ["text", "voice"]);
      assert(!child.children.some((item) => item.kind === "element" || item.value.trim().length > 0), `${child.name} must be empty`);
      turns.push({ text: text(child, "text"), voice: text(child, "voice") });
    }
    assert(turns.length > 0, `${element.name} requires at least one Turn child`);
    assert(turns.length <= 100, `${element.name} accepts at most 100 Turn children`);
    const stability = optionalText(element, "stability");
    const stated: Record<string, readonly GenerationPortValue[] | undefined> = {
      dialogueText: turns.map((turn) => turn.text),
      dialogueVoice: turns.map((turn) => turn.voice),
      stability: stability === undefined ? undefined : [Number(stability)],
      languageCode: optionalText(element, "language-code") === undefined ? undefined : [optionalText(element, "language-code")!],
    };
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
    void resolveReference;
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

function isolationDecoder(endpoint: ExactModelEndpoint): StructuredSurfaceHandler {
  return ({ element, resolveReference }) => {
    exact(element, ["id", "source"], ["id", "source"]);
    const id = text(element, "id");
    const portValue = generationPort(endpoint.ports, "source");
    assert(portValue.value.kind === "media", "ElevenLabs source port is not media");
    const mediaPort = portValue as GenerationMediaPort;
    const source = ref(element, "source", blobTypes.blob, resolveReference);
    if (source.record !== undefined) {
      assert(source.record.value.kind === "blob" && source.record.value.mediaType.startsWith("audio/"),
        `${element.name}.source must reference audio media`);
    }
    const name = "source-0001";
    const bindingId = `${id}.${name}.binding`;
    const records: Array<{ id: string; type: TypeRef; value: { kind: "inline"; value: CanonicalValue }; range: StructuredElement["range"] }> = [{
      id: bindingId,
      type: endpoint.mediaBindings.source!.type,
      value: {
        kind: "inline",
        value: sealGenerationMediaBinding(mediaPort, { role: "audio" }) as unknown as CanonicalValue,
      },
      range: element.range,
    }];
    const names = exactModelMediaInputNames(name);
    const inputs: Record<string, SurfaceResolvedReference["ref"] | { kind: "record"; id: string }> = {
      [names.binding]: { kind: "record", id: bindingId },
      [names.artifact]: source.ref,
    };
    const fragment = createExactModelPrimaryGenerationFragment(endpoint, [{ name, port: "source" }], []);
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

export const decodeElevenLabsMultilingualSurface = speechDecoder(elevenLabsTtsEndpoints.multilingual!, true);
export const decodeElevenLabsTurboSurface = speechDecoder(elevenLabsTtsEndpoints.turbo!, false);
export const decodeElevenLabsDialogueSurface = dialogueDecoder(elevenLabsTtsEndpoints.dialogue!);
export const decodeElevenLabsIsolationSurface = isolationDecoder(elevenLabsTtsEndpoints.isolation!);
