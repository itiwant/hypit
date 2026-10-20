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

import { sunoEndpoints } from "./index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function localName(name: string): string {
  return name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
}

function sameType(left: TypeRef, right: TypeRef): boolean {
  return left.name === right.name && left.module.name === right.module.name && left.module.version === right.module.version;
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

function boolean(element: StructuredElement, name: string): boolean {
  const value = text(element, name);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${element.name}.${name} must be true or false`);
}

function optionalBoolean(element: StructuredElement, name: string): boolean | undefined {
  return element.attributes[name] === undefined ? undefined : boolean(element, name);
}

function optionalNumber(element: StructuredElement, name: string): number | undefined {
  if (element.attributes[name] === undefined) return undefined;
  const value = text(element, name);
  assert(/^\d+(?:\.\d+)?$/u.test(value), `${element.name}.${name} must be a number`);
  return Number(value);
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
  assert(result !== undefined && sameType(result.type, type), `${element.name}.${name} has the wrong type`);
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

/** One `<Reference kind="image|video|audio">` child, bound to the model's matching media port. */
type MediaChild = {
  readonly port: "imageUrls" | "videoUrls" | "audioUrls";
  readonly role: "image" | "video" | "audio";
  readonly source: SurfaceResolvedReference;
};

function mediaChildren(
  element: StructuredElement,
  resolve: (path: string) => SurfaceResolvedReference | undefined,
): readonly MediaChild[] {
  const found: MediaChild[] = [];
  for (const child of element.children) {
    if (child.kind === "text") {
      assert(child.value.trim().length === 0, `${element.name} accepts only Reference children`);
      continue;
    }
    assert(localName(child.name) === "Reference", `${element.name} accepts only Reference children`);
    exact(child, ["kind", "media"], ["kind", "media"]);
    assert(!child.children.some((item) => item.kind === "element" || item.value.trim().length > 0), `${child.name} must be empty`);
    const kind = text(child, "kind");
    assert(kind === "image" || kind === "video" || kind === "audio", `${child.name}.kind must be image, video or audio`);
    const media = ref(child, "media", blobTypes.blob, resolve);
    if (media.record !== undefined) {
      assert(media.record.value.kind === "blob" && media.record.value.mediaType.startsWith(`${kind}/`),
        `${child.name}.media must reference ${kind} media`);
    }
    const port = kind === "image" ? "imageUrls" : kind === "video" ? "videoUrls" : "audioUrls";
    found.push({ port, role: kind, source: media });
  }
  return found;
}

const musicAttributes = [
  "id", "prompt", "lyrics", "style", "title", "negative-tags", "vocal-gender",
  "style-weight", "weirdness-constraint", "audio-weight", "variety",
  "persona-id", "persona-model", "duration", "model", "custom-mode", "instrumental",
] as const;

const soundsAttributes = [
  "id", "prompt", "model", "sound-loop", "sound-tempo", "sound-key", "grab-lyrics",
] as const;

/** Text ports bind through the fragment; only scalar values belong in the draft. */
const musicTextPorts = [
  ["prompt", "prompt"],
  ["lyrics", "lyrics"],
  ["style", "style"],
  ["title", "title"],
  ["negative-tags", "negativeTags"],
] as const;

function musicDecoder(endpoint: ExactModelEndpoint): StructuredSurfaceHandler {
  return ({ element, resolveReference }) => {
    exact(element, [...musicAttributes], ["id", "model", "custom-mode", "instrumental"]);
    const id = text(element, "id");

    const textInputs: Array<{ name: string; port: string; source: SurfaceResolvedReference }> = [];
    for (const [attribute, port] of musicTextPorts) {
      if (element.attributes[attribute] === undefined) continue;
      textInputs.push({ name: port, port, source: textReference(element, attribute, resolveReference) });
    }

    const children = mediaChildren(element, resolveReference);
    const mediaInputs: Array<{ name: string; port: string }> = [];
    const records: Array<{ id: string; type: TypeRef; value: { kind: "inline"; value: CanonicalValue }; range: StructuredElement["range"] }> = [];
    const inputs: Record<string, SurfaceResolvedReference["ref"] | { kind: "record"; id: string }> = {};

    const perPort = new Map<string, number>();
    for (const child of children) {
      const index = (perPort.get(child.port) ?? 0) + 1;
      perPort.set(child.port, index);
      const portValue = generationPort(endpoint.ports, child.port);
      assert(portValue.value.kind === "media", `Suno ${child.port} port is not media`);
      const mediaPort = portValue as GenerationMediaPort;
      const maximum = mediaPort.maxItems;
      assert(index <= maximum, `${element.name} accepts at most ${maximum} ${child.role} references`);
      const name = `${child.port}-${String(index).padStart(4, "0")}`;
      const bindingId = `${id}.${name}.binding`;
      records.push({
        id: bindingId,
        type: endpoint.mediaBindings[child.port]!.type,
        value: {
          kind: "inline",
          value: sealGenerationMediaBinding(mediaPort, { role: child.role }) as unknown as CanonicalValue,
        },
        range: element.range,
      });
      const names = exactModelMediaInputNames(name);
      inputs[names.binding] = { kind: "record", id: bindingId };
      inputs[names.artifact] = child.source.ref;
      mediaInputs.push({ name, port: child.port });
    }

    const stated: Record<string, readonly GenerationPortValue[] | undefined> = {
      customMode: [boolean(element, "custom-mode")],
      instrumental: [boolean(element, "instrumental")],
      model: [text(element, "model")],
      vocalGender: optionalText(element, "vocal-gender") === undefined ? undefined : [optionalText(element, "vocal-gender")!],
      styleWeight: optionalNumber(element, "style-weight") === undefined ? undefined : [optionalNumber(element, "style-weight")!],
      weirdnessConstraint: optionalNumber(element, "weirdness-constraint") === undefined ? undefined : [optionalNumber(element, "weirdness-constraint")!],
      audioWeight: optionalNumber(element, "audio-weight") === undefined ? undefined : [optionalNumber(element, "audio-weight")!],
      variety: optionalNumber(element, "variety") === undefined ? undefined : [optionalNumber(element, "variety")!],
      personaId: optionalText(element, "persona-id") === undefined ? undefined : [optionalText(element, "persona-id")!],
      personaModel: optionalText(element, "persona-model") === undefined ? undefined : [optionalText(element, "persona-model")!],
      duration: optionalNumber(element, "duration") === undefined ? undefined : [optionalNumber(element, "duration")!],
    };
    const draft = sealGenerationRequestDraft(endpoint.ports, Object.fromEntries(
      Object.entries(stated).filter((entry): entry is [string, readonly GenerationPortValue[]] => entry[1] !== undefined),
    ));
    records.push({
      id: `${id}.draft`,
      type: endpoint.draftType,
      value: { kind: "inline", value: draft as unknown as CanonicalValue },
      range: element.range,
    });
    inputs.draft = { kind: "record", id: `${id}.draft` };
    for (const input of textInputs) inputs[exactModelTextInputName(input.name)] = input.source.ref;

    const fragment = createExactModelPrimaryGenerationFragment(
      endpoint,
      mediaInputs,
      textInputs.map((input) => ({ name: input.name, port: input.port })),
    );
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

function soundsDecoder(endpoint: ExactModelEndpoint): StructuredSurfaceHandler {
  return ({ element, resolveReference }) => {
    exact(element, [...soundsAttributes], ["id", "prompt", "model"]);
    const id = text(element, "id");
    const prompt = textReference(element, "prompt", resolveReference);
    const stated: Record<string, readonly GenerationPortValue[] | undefined> = {
      model: [text(element, "model")],
      soundLoop: optionalBoolean(element, "sound-loop") === undefined ? undefined : [optionalBoolean(element, "sound-loop")!],
      soundTempo: optionalNumber(element, "sound-tempo") === undefined ? undefined : [optionalNumber(element, "sound-tempo")!],
      soundKey: optionalText(element, "sound-key") === undefined ? undefined : [optionalText(element, "sound-key")!],
      grabLyrics: optionalBoolean(element, "grab-lyrics") === undefined ? undefined : [optionalBoolean(element, "grab-lyrics")!],
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
      [exactModelTextInputName("prompt")]: prompt.ref,
    };
    const fragment = createExactModelPrimaryGenerationFragment(endpoint, [], [{ name: "prompt", port: "prompt" }]);
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

export const decodeSunoMusicSurface = musicDecoder(sunoEndpoints.music!);
export const decodeSunoSoundsSurface = soundsDecoder(sunoEndpoints.sounds!);
